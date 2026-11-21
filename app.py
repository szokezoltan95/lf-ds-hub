import base64
import binascii
import hashlib
import json
from threading import Event, Thread
import push_service
import permissions as access

import hmac
import os
import re
import secrets
from xml.etree import ElementTree as ET
from contextlib import asynccontextmanager
from datetime import date as CalendarDate, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from PIL import Image, ImageOps, UnidentifiedImageError

import psycopg
from psycopg.types.json import Jsonb
import qrcode
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row
from pydantic import AliasChoices, AwareDatetime, BaseModel, Field, StringConstraints, TypeAdapter, model_validator

ROOT = Path(__file__).resolve().parent
PUBLIC_URL = os.environ.get("HUB_PUBLIC_URL", "http://localhost:8081/dronesoccer/").rstrip("/")
url = urlsplit(PUBLIC_URL)
PREFIX = url.path
if (url.scheme not in {"http", "https"} or not url.hostname or url.username or url.query
        or url.fragment or (PREFIX and any(part in {".", "..", ""} for part in PREFIX[1:].split("/")))):
    raise RuntimeError("Invalid HUB_PUBLIC_URL")
ORIGIN = f"{url.scheme}://{url.netloc}"
COOKIE = "lf_ds_hub_session"
CLUB_ZONE = ZoneInfo("Europe/Bratislava")
MENU_KEYS = ("home", "calendar", "attendance", "scanner", "messages", "announcements", "members",
             "team", "development", "drills", "equipment", "documents")
ROLE_DEFINITIONS = {
    "player": ("Hráč", "Zúčastňuje sa na činnosti tímu a používa členskú aplikáciu.", True, False,
               ("home", "calendar", "scanner", "messages", "announcements", "team", "equipment", "documents")),
    "coach": ("Tréner", "Plánuje tréningy, vedie dochádzku a pripravuje zostavy.", True, True,
              MENU_KEYS),
    "club_leader": ("Vedúci klubu", "Koordinuje chod klubu a jeho členov.", True, True, MENU_KEYS),
    "deputy_leader": ("Zástupca vedúceho klubu", "Zastupuje vedúceho a pomáha riadiť klub.", True, True, MENU_KEYS),
    "administrator": ("Administratívny pracovník", "Pomáha s členskou evidenciou, oznamami a dokumentmi.", True, True,
                      ("home", "calendar", "messages", "announcements", "members", "documents")),
    "equipment_technician": ("Technik vybavenia", "Eviduje klubovú techniku a jej používanie.", True, True,
                              ("home", "calendar", "scanner", "messages", "equipment", "documents")),
    "social_media_manager": ("Správca sociálnych sietí", "Pripravuje klubové oznamy a komunikačné podklady.", True, True,
                             ("home", "messages", "announcements", "documents")),
    "competition_coordinator": ("Koordinátor súťaží", "Koordinuje zápasy, nominácie a súťažné zostavy.", True, True,
              ("home", "calendar", "attendance", "members", "team", "announcements", "documents")),
    "recruitment_coordinator": ("Koordinátor náboru", "Komunikuje so záujemcami a organizuje nábor.", False, False, ()),
    "safety_coordinator": ("Bezpečnostný a prevádzkový koordinátor", "Spravuje bezpečnostné postupy a poučenia.", False, False, ()),
    "team_coordinator": ("Koordinátor tímov", "Koordinuje zloženie tímov a priradenie hráčov.", True, True,
                         ("home", "calendar", "members", "team")),
    "content_creator": ("Fotograf / tvorca obsahu", "Pripravuje fotografie a klubový obsah.", False, False, ()),
}
PLAYER_READ_ONLY_PAGES = {"announcements", "team", "documents"}


def seed_access_control(conn):
    for key, (name, description, available, admin_access, pages) in ROLE_DEFINITIONS.items():
        can_create_invites = key in {"coach", "club_leader", "deputy_leader"}
        can_assign_invite_roles = key in {"club_leader", "deputy_leader"}
        conn.execute("""INSERT INTO role_catalog(role_key,name,description,available,admin_access,
            can_create_invites,can_assign_invite_roles)
            VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(role_key) DO UPDATE SET
            name=excluded.name,description=excluded.description,available=excluded.available,
            admin_access=excluded.admin_access""",
            (key, name, description, available, admin_access, can_create_invites, can_assign_invite_roles))
        with conn.cursor() as cursor:
            cursor.executemany("""INSERT INTO role_menu_permissions(role_key,menu_key,enabled,access_level)
                VALUES (%s,%s,%s,%s) ON CONFLICT(role_key,menu_key) DO NOTHING""",
                [(key, page, page in pages,
                  "none" if page not in pages else "read" if key == "player" and page in PLAYER_READ_ONLY_PAGES else "edit")
                 for page in MENU_KEYS])


def sync_account_roles(conn, member_id, roles):
    roles = sorted(set(roles))
    account_role = "coach" if any(ROLE_DEFINITIONS[key][3] for key in roles) else "member"
    conn.execute("UPDATE members SET club_roles=%s,role=%s WHERE id=%s",
                 (roles, account_role, member_id))


def require(user, *keys):
    if not any(access.allows(user, key) for key in keys):
        raise HTTPException(403, "Na tento úkon nemáš oprávnenie.")


def require_owner(user, row, prefix):
    if not access.allows(user, prefix + "_all"):
        require(user, prefix + "_own")
        if row["created_by"] != user["id"]:
            raise HTTPException(403, "Tento úkon môžeš vykonať iba pri vlastnej udalosti.")


Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254,
                                        pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Code = Annotated[str, StringConstraints(pattern=r"^LF-B[0-9]{2,6}$")]
ChargerCode = Annotated[str, StringConstraints(pattern=r"^LF-X[0-9]{2,6}$")]
EquipmentCode = Annotated[str, StringConstraints(pattern=r"^LF-(?:C|D|X)[0-9]{2,6}$")]


def connect():
    return psycopg.connect(
        os.environ.get("HUB_DATABASE_URL", ""),
        **({} if os.environ.get("HUB_DATABASE_URL") else {
            "host": "db", "dbname": "hub", "user": "hub",
            "password": os.environ["POSTGRES_PASSWORD"],
        }),
        row_factory=dict_row,
        connect_timeout=5,
    )


def database():
    with connect() as conn:
        yield conn


DB = Annotated[psycopg.Connection, Depends(database, scope="function")]


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    result = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8,
                            p=1, maxmem=64 * 1024 * 1024)
    return f"{salt}:{result.hex()}"


def matches_password(password, saved):
    return hmac.compare_digest(saved, password_hash(password, saved.split(":")[0]))


def seed_default_drills(conn):
    catalog = json.loads((ROOT / "default_drills.json").read_text(encoding="utf-8"))
    with conn.cursor() as cursor:
        cursor.executemany(
            """INSERT INTO drills (seed_key, title, objective, duration_minutes, difficulty, equipment, details)
            SELECT %s, %s, %s, %s, %s, %s, %s
            WHERE NOT EXISTS (SELECT 1 FROM drills WHERE lower(btrim(title)) = lower(%s))
            ON CONFLICT (seed_key) DO NOTHING""",
            [(entry["key"], entry["title"], entry["objective"], entry["duration_minutes"],
              entry["difficulty"], entry["equipment"], Jsonb(entry["details"]), entry["title"])
             for entry in catalog],
        )


@asynccontextmanager
async def lifespan(_app):
    try:
        password = TypeAdapter(Password).validate_python(os.environ.get("HUB_ADMIN_PASSWORD", ""))
    except ValueError:
        raise RuntimeError("Set HUB_ADMIN_PASSWORD to a password of 8–128 characters") from None

    with connect() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(81364, 1)")
        conn.execute((ROOT / "schema.sql").read_text(), prepare=False)
        seed_default_drills(conn)
        conn.execute((ROOT / "equipment_schema.sql").read_text(), prepare=False)
        seed_access_control(conn)
        conn.execute((ROOT / "permissions_schema.sql").read_text(), prepare=False)
        access.migrate(conn)
        account = conn.execute(
            "SELECT id, password_hash FROM members WHERE role='superadmin' FOR UPDATE"
        ).fetchone()
        saved = account["password_hash"] if account else None
        if not saved or not matches_password(password, saved):
            hashed = password_hash(password)
            if account:
                conn.execute("UPDATE members SET password_hash=%s WHERE id=%s", (hashed, account["id"]))
                conn.execute("DELETE FROM sessions WHERE member_id=%s", (account["id"],))
            else:
                conn.execute(
                    "INSERT INTO members (name, role, password_hash, club_roles) VALUES (%s, 'superadmin', %s, '{}')",
                    ("Systémový správca", hashed),
                )
            conn.execute("DELETE FROM login_attempts WHERE email='admin'")
        push_service.initialize(conn)
    stop = Event()
    worker = Thread(target=push_service.worker, args=(connect, stop, PUBLIC_URL), daemon=True)
    worker.start()
    try:
        yield
    finally:
        stop.set()
        worker.join(timeout=12)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
api = APIRouter(prefix=f"{PREFIX}/api")


@app.middleware("http")
async def protect(request, call_next):
    is_api = request.url.path.startswith(f"{PREFIX}/api/")
    if is_api and request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("origin") != ORIGIN:
            return JSONResponse({"detail": "Požiadavka má nepovolený pôvod."}, status_code=403,
                                headers={"Cache-Control": "no-store"})
    response = await call_next(request)
    if is_api or request.url.path in {f"{PREFIX}/", f"{PREFIX}/sw.js", f"{PREFIX}/index.html", f"{PREFIX}/manifest.webmanifest"}:
        response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    policy = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    # The decoder runs in a separate worker. Only its script can compile WebAssembly.
    if re.fullmatch(r"/assets/scanner-worker-[A-Za-z0-9_-]+[.]js", request.url.path.removeprefix(PREFIX)):
        policy += "; script-src 'self' 'wasm-unsafe-eval'"
    response.headers["Content-Security-Policy"] = policy
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    return JSONResponse({"detail": "Skontroluj vyplnené údaje."}, status_code=422)


def identity(request: Request, conn: DB):
    token = request.cookies.get(COOKIE, "")
    member = conn.execute(
        """SELECT m.id, m.name, m.email, m.role, m.club_roles, m.pwa_show_card, m.pwa_show_popup, m.push_messages, m.push_calendar, m.push_announcements, m.avatar_version, m.dashboard_preferences, p.roles AS preview_roles FROM sessions s
        LEFT JOIN permission_previews p ON p.session_hash=s.token_hash
        JOIN members m ON m.id = s.member_id
        WHERE s.token_hash = %s AND s.expires_at > now() AND m.active""", (digest(token),)
    ).fetchone()
    if not member:
        raise HTTPException(401, "Prihlás sa do portálu.")
    actual_admin = member["role"] == "superadmin"
    preview = member.pop("preview_roles") if actual_admin else None
    member.pop("preview_roles", None)
    member["roles"] = preview if preview is not None else member["club_roles"]
    if preview is not None:
        member["role"] = "member"
    member["preview"] = preview is not None
    member["session_hash"] = digest(token)
    member["permissions"] = sorted(access.CAPABILITIES) if member["role"] == "superadmin" else access.effective(conn, member["roles"] or [])
    member["menu_access"] = [page for page in access.PAGES if access.allows(member, page + ".open")]
    member["can_create_invites"] = access.allows(member, "members.accounts.invite")
    member["can_assign_invite_roles"] = access.allows(member, "members.accounts.invite_roles")

    endpoint = request.scope["route"].name
    rule = access.ENDPOINTS.get(endpoint)
    if rule is None:
        raise HTTPException(403, "Funkcia nemá nastavenú kontrolu prístupu.")
    if rule == "@restore":
        if not actual_admin:
            raise HTTPException(403, "Náhľad je dostupný iba správcovi.")
    elif member["preview"] and ((request.method not in {"GET", "HEAD"} and endpoint != "scan") or endpoint in {
        "my_card", "my_card_qr", "member_card", "member_card_qr"
    }):
        raise HTTPException(403, "V náhľade roly sa údaje nemenia.")
    elif rule == "@admin":
        if member["role"] != "superadmin":
            raise HTTPException(403, "Tento úkon je dostupný iba správcovi.")
    elif rule not in {"-", "@action"}:
        require(member, rule)
    return member


User = Annotated[dict, Depends(identity, scope="function")]


def superadmin(user: User):
    if user["role"] != "superadmin":
        raise HTTPException(403, "Tento úkon môže vykonať iba poverený správca.")
    return user


Superadmin = Annotated[dict, Depends(superadmin, scope="function")]


class Login(BaseModel):
    login: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True,
                                           min_length=1, max_length=254)] = Field(
        validation_alias=AliasChoices("login", "email")
    )
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class Invite(BaseModel):
    name: Short
    email: Email
    roles: list[str] = Field(default_factory=lambda: ["player"], max_length=12)


class Accept(BaseModel):
    token: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]
    password: Password
    email: Email


class CoachAccount(Invite):
    password: Password
    roles: list[str] = Field(default_factory=list, max_length=12)


class AccountRole(BaseModel):
    role: Literal["coach", "member"]


class Active(BaseModel):
    active: bool


class RoleRequests(BaseModel):
    roles: list[str] = Field(min_length=1, max_length=12)


class RoleDecision(BaseModel):
    status: Literal["approved", "rejected"]


class RoleGrantConfig(BaseModel):
    grants: list[str] = Field(max_length=500)
    expected: list[str] = Field(max_length=500)


class TrialBannerSetting(BaseModel):
    enabled: bool


@api.get("/health")
def health(conn: DB):
    conn.execute("SELECT 1")
    return {"status": "ok"}


@api.get("/public/settings")
def public_settings(conn: DB):
    row = conn.execute("SELECT value FROM hub_settings WHERE setting_key='trial_banner_enabled'").fetchone()
    return {"trial_banner_enabled": bool(row["value"]) if row else True}


@api.get("/role-config")
def get_role_config(conn: DB, _admin: Superadmin):
    roles = conn.execute("""SELECT c.role_key AS key,c.name,c.description,c.available,c.admin_access,
        COALESCE(array_agg(g.permission ORDER BY g.permission)
            FILTER (WHERE g.permission IS NOT NULL), '{}') AS grants
        FROM role_catalog c LEFT JOIN role_grants g USING(role_key)
        GROUP BY c.role_key ORDER BY c.name""").fetchall()
    for role in roles:
        role["grants"] = [key for key in role["grants"] if key in access.CAPABILITIES]
    return {"roles": roles, "catalog": access.catalog()}


@api.get("/role-catalog")
def get_role_catalog(conn: DB, user: User):
    rows=conn.execute("SELECT role_key AS key,name,description,available FROM role_catalog ORDER BY name").fetchall()
    for row in rows:
        grants = access.effective(conn, [row["key"]])
        row["capabilities"] = [{"name": access.CAPABILITIES[key][1], "available": True}
                               for key in grants if not key.endswith(".open")]
    return rows


@api.put("/role-config/{role_key}")
def update_role_config(role_key: str, data: RoleGrantConfig, conn: DB, _admin: Superadmin):
    if not conn.execute("SELECT 1 FROM role_catalog WHERE role_key=%s FOR UPDATE", (role_key,)).fetchone():
        raise HTTPException(404, "Rola sa nenašla.")
    grants = set(data.grants)
    if not grants <= access.CAPABILITIES.keys() or any(
        not set(access.dependencies(key)) <= grants for key in grants
    ):
        raise HTTPException(422, "Oprávnenia obsahujú neznámu položku alebo chýba potrebný prístup.")
    stored = {row["permission"] for row in conn.execute(
        "SELECT permission FROM role_grants WHERE role_key=%s", (role_key,)
    ).fetchall()} & access.CAPABILITIES.keys()
    if stored != set(data.expected):
        raise HTTPException(409, "Oprávnenia sa medzitým zmenili. Načítaj ich znova.")
    added, removed = sorted(grants - stored), sorted(stored - grants)
    if added or removed:
        conn.execute("DELETE FROM role_grants WHERE role_key=%s AND permission=ANY(%s)", (role_key, removed))
        with conn.cursor() as cursor:
            cursor.executemany("INSERT INTO role_grants(role_key,permission) VALUES (%s,%s)",
                               [(role_key, key) for key in added])
        conn.execute("INSERT INTO role_grant_audit(actor_id,role_key,added,removed) VALUES (%s,%s,%s,%s)",
                     (_admin["id"], role_key, added, removed))
    return {"grants": sorted(grants)}


@api.get("/role-config/audit")
def permission_audit(conn: DB, _admin: Superadmin):
    return conn.execute("""SELECT a.id,a.role_key,a.added,a.removed,a.created_at,m.name AS actor
        FROM role_grant_audit a LEFT JOIN members m ON m.id=a.actor_id ORDER BY a.id DESC LIMIT 100""").fetchall()


@api.get("/role-config/member/{member_id}")
def permission_member(member_id: int, conn: DB, _admin: Superadmin):
    member = conn.execute("SELECT name,club_roles FROM members WHERE id=%s AND role<>'superadmin'",
                          (member_id,)).fetchone()
    if not member:
        raise HTTPException(404, "Člen sa nenašiel.")
    roles = member["club_roles"] or []
    rows = conn.execute("SELECT role_key,permission FROM role_grants WHERE role_key=ANY(%s)", (roles,)).fetchall()
    return {"name": member["name"], "roles": roles, "permissions": {
        key: sorted(row["role_key"] for row in rows if row["permission"] == key)
        for key in access.effective(conn, roles)
    }}


@api.post("/role-preview")
def start_permission_preview(data: RoleRequests, conn: DB, user: Superadmin):
    roles = sorted(set(data.roles))
    if not roles or not set(roles) <= ROLE_DEFINITIONS.keys():
        raise HTTPException(422, "Vyber platné roly.")
    conn.execute("""INSERT INTO permission_previews(session_hash,roles) VALUES (%s,%s)
        ON CONFLICT(session_hash) DO UPDATE SET roles=excluded.roles""", (user["session_hash"], roles))
    return {"ok": True}


@api.delete("/role-preview")
def stop_permission_preview(conn: DB, user: User):
    conn.execute("DELETE FROM permission_previews WHERE session_hash=%s", (user["session_hash"],))
    return {"ok": True}


@api.put("/admin/trial-banner")
def set_trial_banner(data: TrialBannerSetting, conn: DB, _admin: Superadmin):
    conn.execute("""INSERT INTO hub_settings(setting_key,value) VALUES ('trial_banner_enabled',%s)
        ON CONFLICT(setting_key) DO UPDATE SET value=excluded.value""", (Jsonb(data.enabled),))
    return {"trial_banner_enabled":data.enabled}


@api.post("/me/role-requests")
def create_role_requests(data: RoleRequests, conn: DB, user: User):
    if user["role"] == "superadmin":
        raise HTTPException(403, "Systémový účet nemôže žiadať o klubové roly.")
    roles = set(data.roles)
    if not roles or not roles <= set(ROLE_DEFINITIONS):
        raise HTTPException(422, "Žiadosť obsahuje neznámu rolu.")
    existing = set(user["roles"])
    if roles & existing:
        raise HTTPException(409, "O niektorú z vybraných rolí už máš pridelenú.")
    for role_key in roles:
        conn.execute("INSERT INTO role_requests(member_id,role_key) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                     (user["id"], role_key))
    return {"ok":True}


@api.get("/me/role-requests")
def own_role_requests(conn: DB, user: User):
    return conn.execute("""SELECT r.id,r.role_key,c.name,c.description,c.available,r.status,r.created_at
        FROM role_requests r JOIN role_catalog c USING(role_key) WHERE r.member_id=%s
        ORDER BY r.created_at DESC""", (user["id"],)).fetchall()


@api.get("/role-requests")
def role_requests(conn: DB, user: User):
    return conn.execute("""SELECT r.id,r.member_id,m.name AS member_name,m.email,r.role_key,c.name AS role_name,
        r.created_at,r.status FROM role_requests r JOIN members m ON m.id=r.member_id
        JOIN role_catalog c USING(role_key) WHERE r.status='pending' AND m.role IN ('member','coach') ORDER BY r.created_at,r.id""").fetchall()


@api.put("/role-requests/{request_id}")
def decide_role_request(request_id: int, data: RoleDecision, conn: DB, _admin: User):
    request = conn.execute("""SELECT member_id,role_key FROM role_requests
        WHERE id=%s AND status='pending'
        AND member_id IN (SELECT id FROM members WHERE role IN ('member','coach')) FOR UPDATE""", (request_id,)).fetchone()
    if not request:
        raise HTTPException(404, "Čakajúca žiadosť sa nenašla.")
    if data.status == "approved":
        require_grantable_roles(conn, _admin, [request["role_key"]])
    conn.execute("UPDATE role_requests SET status=%s,decided_at=now(),decided_by=%s WHERE id=%s",
                 (data.status, _admin["id"], request_id))
    if data.status == "approved":
        row = conn.execute("SELECT club_roles FROM members WHERE id=%s AND active FOR UPDATE",
                           (request["member_id"],)).fetchone()
        if row:
            sync_account_roles(conn, request["member_id"], set(row["club_roles"] or []) | {request["role_key"]})
    return {"ok":True}


@api.post("/login")
def login(data: Login, response: Response, conn: DB):
    if data.login == "admin":
        member = conn.execute(
            "SELECT id, active, password_hash FROM members WHERE role='superadmin' FOR UPDATE"
        ).fetchone()
    else:
        member = conn.execute(
            "SELECT id, active, password_hash FROM members WHERE email=%s FOR UPDATE", (data.login,)
        ).fetchone()
    if not member or not member["active"] or not member["password_hash"]:
        raise HTTPException(401, "Nesprávne prihlasovacie meno alebo heslo.")
    attempts = conn.execute(
        """INSERT INTO login_attempts VALUES (%s, 1, now()) ON CONFLICT (email) DO UPDATE
        SET attempts = CASE WHEN login_attempts.window_started < now() - interval '15 minutes'
        THEN 1 ELSE least(login_attempts.attempts + 1, 11) END,
        window_started = CASE WHEN login_attempts.window_started < now() - interval '15 minutes'
        THEN now() ELSE login_attempts.window_started END RETURNING attempts""", (data.login,)
    ).fetchone()["attempts"]
    if attempts > 10:
        conn.commit()
        raise HTTPException(429, "Skús sa prihlásiť neskôr.")
    saved = member["password_hash"]
    if not matches_password(data.password, saved):
        conn.commit()
        raise HTTPException(401, "Nesprávne prihlasovacie meno alebo heslo.")
    conn.execute("DELETE FROM login_attempts WHERE email = %s", (data.login,))
    conn.execute("DELETE FROM sessions WHERE expires_at <= now()")
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions VALUES (%s, %s, now() + interval '30 days')",
                 (digest(token), member["id"]))
    response.set_cookie(COOKIE, token, httponly=True, secure=url.scheme == "https",
                        samesite="lax", path=f"{PREFIX}/", max_age=30 * 86400)
    return {"ok": True}


@api.post("/logout")
def logout(request: Request, response: Response, conn: DB):
    conn.execute("DELETE FROM sessions WHERE token_hash = %s",
                 (digest(request.cookies.get(COOKIE, "")),))
    response.delete_cookie(COOKIE, path=f"{PREFIX}/")
    return {"ok": True}


@api.get("/me")
def me(user: User):
    return {key: value for key, value in user.items() if key not in {"club_roles", "session_hash"}}



class InstallPreferences(BaseModel):
    pwa_show_card: bool
    pwa_show_popup: bool


@api.put("/me/install-preferences")
def update_install_preferences(data: InstallPreferences, conn: DB, user: User):
    conn.execute(
        "UPDATE members SET pwa_show_card=%s, pwa_show_popup=%s WHERE id=%s",
        (data.pwa_show_card, data.pwa_show_popup, user["id"]),
    )
    return data


DashboardWidgetId = Literal["event", "schedule", "rsvp", "attendance", "followup", "announcements", "messages",
                            "role_requests", "battery_status", "battery_activity", "team_attendance",
                            "rsvp_summary", "member_invites", "quick_links"]
DashboardLinkId = Literal["calendar", "attendance", "messages", "announcements", "members", "team",
                          "development", "lineups", "drills", "equipment", "documents", "scanner", "member_qr"]


class DashboardWidgetPreference(BaseModel):
    id: DashboardWidgetId
    display: Literal["both", "desktop", "mobile"] = "both"


class DashboardPreferences(BaseModel):
    widgets: list[DashboardWidgetPreference | DashboardWidgetId] = Field(max_length=14)
    quick_links: list[DashboardLinkId] = Field(default_factory=list, max_length=13)
    theme: Annotated[str, StringConstraints(pattern=r"^(blue|sky|mint|coral|#[0-9a-fA-F]{6})$")] = "blue"
    columns: Literal[1, 2, 3, 4] = 2


@api.put("/me/dashboard-preferences")
def update_dashboard_preferences(data: DashboardPreferences, conn: DB, user: User):
    widgets = []
    seen = set()
    for item in data.widgets:
        value = item if isinstance(item, str) else item.model_dump()
        key = value if isinstance(value, str) else value["id"]
        if key not in seen:
            widgets.append({"id": key, "display": "both"} if isinstance(value, str) else value)
            seen.add(key)
    preferences = {"widgets": widgets, "quick_links": list(dict.fromkeys(data.quick_links)),
                   "theme": data.theme, "columns": data.columns}
    conn.execute("UPDATE members SET dashboard_preferences=%s WHERE id=%s",
                 (Jsonb(preferences), user["id"]))
    return preferences


class Profile(BaseModel):
    name: Short


class ChangePassword(BaseModel):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    password: Password


@api.put("/me")
def update_profile(data: Profile, conn: DB, user: User):
    conn.execute("UPDATE members SET name=%s WHERE id=%s", (data.name, user["id"]))
    return {"ok": True}


@api.put("/me/avatar")
async def upload_avatar(request: Request, conn: DB, user: User):
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > 5 * 1024 * 1024:
            raise HTTPException(413, "Fotka môže mať najviac 5 MB.")
        content.extend(chunk)
    try:
        with Image.open(BytesIO(content), formats=["JPEG", "PNG", "WEBP"]) as image:
            if image.width * image.height > 24_000_000:
                raise ValueError("Image is too large")
            photo = ImageOps.fit(ImageOps.exif_transpose(image).convert("RGB"), (256, 256))
            output = BytesIO()
            photo.save(output, format="JPEG", quality=85)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        raise HTTPException(422, "Vyber platnú fotku vo formáte JPG, PNG alebo WebP.")
    conn.execute("UPDATE members SET avatar=%s,avatar_version=%s WHERE id=%s",
                 (output.getvalue(), uuid4(), user["id"]))
    return {"ok": True}


@api.delete("/me/avatar")
def delete_avatar(conn: DB, user: User):
    conn.execute("UPDATE members SET avatar=NULL,avatar_version=NULL WHERE id=%s", (user["id"],))
    return {"ok": True}


@api.get("/avatars/{member_id}")
def avatar(member_id: int, conn: DB, user: User):
    row = conn.execute(
        "SELECT avatar FROM members WHERE id=%s AND (role<>'superadmin' OR id=%s)",
        (member_id, user["id"]),
    ).fetchone()
    if not row or row["avatar"] is None:
        return Response(status_code=204)
    return Response(row["avatar"], media_type="image/jpeg")


@api.put("/me/password")
def change_password(data: ChangePassword, request: Request, conn: DB, user: User):
    if user["role"] == "superadmin":
        raise HTTPException(409, "Heslo systémového správcu sa nastavuje na serveri.")
    account = conn.execute(
        "SELECT password_hash FROM members WHERE id=%s FOR UPDATE", (user["id"],)
    ).fetchone()
    if not matches_password(data.current_password, account["password_hash"]):
        raise HTTPException(400, "Aktuálne heslo nie je správne.")
    conn.execute(
        "UPDATE members SET password_hash=%s WHERE id=%s",
        (password_hash(data.password), user["id"]),
    )
    conn.execute(
        "DELETE FROM sessions WHERE member_id=%s AND token_hash<>%s",
        (user["id"], digest(request.cookies.get(COOKIE, ""))),
    )
    return {"ok": True}


@api.get("/me/attendance")
def own_attendance(conn: DB, user: User):
    return conn.execute(
        """SELECT t.id, t.title, t.starts_at, p.attended FROM participation p
        JOIN trainings t ON t.id=p.training_id
        JOIN members m ON m.id=p.member_id AND m.role IN ('member','coach')
        WHERE p.member_id=%s
        AND p.attended IS NOT NULL ORDER BY t.starts_at DESC""", (user["id"],),
    ).fetchall()


@api.get("/members")
def members(conn: DB, _user: User):
    return conn.execute(
        """SELECT m.id, CASE WHEN %s THEN m.email END AS email, m.name, m.role,
        m.club_roles AS roles, m.avatar_version, m.active, m.password_hash IS NOT NULL AS registered,
        CASE WHEN %s THEN (SELECT count(*) FROM participation WHERE member_id=m.id AND attended=true) END AS attended_count,
        CASE WHEN %s THEN (SELECT count(*) FROM participation WHERE member_id=m.id AND attended IS NOT NULL) END AS recorded_count,
        CASE WHEN %s OR (%s AND m.id=%s) THEN COALESCE((
          SELECT jsonb_agg(to_jsonb(items) ORDER BY items.code) FROM (
            SELECT a.code,a.kind,a.label,'assigned' AS custody FROM equipment_assets a
            JOIN equipment_current_assignment c ON c.code=a.code AND c.action='assigned' AND c.member_id=m.id
            UNION ALL
            SELECT a.code,a.kind,a.label,l.status FROM equipment_assets a
            JOIN equipment_loans l ON l.code=a.code AND l.member_id=m.id AND l.status IN ('pending','accepted')
          ) items
        ), '[]'::jsonb) ELSE '[]'::jsonb END AS equipment
        FROM members m WHERE role IN ('member','coach') ORDER BY name,id""",
        (access.allows(_user, "members.accounts.contacts"),
         access.allows(_user, "attendance.records.member"), access.allows(_user, "attendance.records.member"),
         access.allows(_user, "equipment.loans.read"), access.allows(_user, "equipment.loans.own"), _user["id"]),
    ).fetchall()


class MemberRoles(BaseModel):
    roles: list[str] = Field(min_length=1, max_length=12)


@api.put("/members/{member_id}/roles")
def update_member_roles(member_id: int, data: MemberRoles, conn: DB, _admin: Superadmin):
    roles = set(data.roles)
    if not roles or not roles <= set(ROLE_DEFINITIONS):
        raise HTTPException(422, "Zoznam obsahuje neznámu rolu.")
    current = conn.execute("SELECT role FROM members WHERE id=%s AND role IN ('member','coach') FOR UPDATE",
                           (member_id,)).fetchone()
    if not current:
        raise HTTPException(404, "Člena sa nenašlo.")
    sync_account_roles(conn, member_id, roles)
    return {"roles":sorted(roles)}


def require_grantable_roles(conn, user, roles):
    if user["role"] == "superadmin":
        return
    permissions = set(user["permissions"])
    if any(not set(access.effective(conn, [role])) <= permissions for role in roles):
        raise HTTPException(403, "Môžeš prideliť iba roly, ktorých práva máš aj ty.")


@api.post("/members/invite")
def invite(data: Invite, conn: DB, user: User):
    if user["role"] != "superadmin" and not user.get("can_create_invites"):
        raise HTTPException(403, "Nemáš oprávnenie vytvárať pozvánky.")
    can_assign_roles = user["role"] == "superadmin" or user.get("can_assign_invite_roles", False)
    if not can_assign_roles and data.roles != ["player"]:
        raise HTTPException(403, "Nemáš oprávnenie priraďovať roly pri pozvánke.")
    roles = sorted(set(data.roles))
    if not roles or not set(roles) <= set(ROLE_DEFINITIONS):
        raise HTTPException(422, "Pozvánka obsahuje neznámu rolu.")
    if can_assign_roles:
        require_grantable_roles(conn, user, roles)
    account_role = "coach" if any(ROLE_DEFINITIONS[role][3] for role in roles) else "member"
    token = secrets.token_urlsafe(32)
    member = conn.execute(
        """INSERT INTO members (email, name, role, club_roles, invite_hash, invite_until)
        VALUES (%s, %s, %s, %s, %s, now() + interval '7 days')
        ON CONFLICT (email) DO UPDATE SET name = excluded.name, invite_hash = excluded.invite_hash,
        invite_until = excluded.invite_until, role=CASE WHEN %s THEN excluded.role ELSE members.role END,
        club_roles=CASE WHEN %s THEN excluded.club_roles ELSE members.club_roles END
        WHERE members.role IN ('member','coach') AND members.active AND members.password_hash IS NULL
        RETURNING id""", (data.email, data.name, account_role, roles, digest(token),
                              can_assign_roles, can_assign_roles)
    ).fetchone()
    if not member:
        raise HTTPException(409, "Tento e-mail už patrí existujúcemu účtu.")
    return {"invite_url": f"{PUBLIC_URL}/#invite={token}"}


@api.post("/members/coaches")
def create_coach(data: CoachAccount, conn: DB, _admin: Superadmin):
    roles = set(data.roles) | {"coach"}
    if not roles <= set(ROLE_DEFINITIONS):
        raise HTTPException(422, "Zoznam obsahuje neznámu rolu.")
    roles = sorted(roles)
    account_role = "coach" if any(ROLE_DEFINITIONS[key][3] for key in roles) else "member"
    member = conn.execute(
        """INSERT INTO members (email, name, role, club_roles, password_hash)
        VALUES (%s, %s, %s, %s, %s) ON CONFLICT (email) DO NOTHING RETURNING id""",
        (data.email, data.name, account_role, roles, password_hash(data.password)),
    ).fetchone()
    if not member:
        raise HTTPException(409, "Tento e-mail už patrí existujúcemu účtu.")
    return {"ok": True}


@api.put("/members/{member_id}/role")
def set_role(member_id: int, data: AccountRole, conn: DB, _admin: Superadmin):
    member = conn.execute(
        """SELECT role FROM members WHERE id=%s AND role IN ('member', 'coach')
        AND password_hash IS NOT NULL FOR UPDATE""", (member_id,),
    ).fetchone()
    if not member:
        raise HTTPException(404, "Aktivovaný účet sa nenašiel.")
    if member["role"] != data.role:
        conn.execute(
            """UPDATE members SET role=%s, club_roles=%s, invite_hash=NULL, invite_until=NULL
            WHERE id=%s""", (data.role, ["coach"] if data.role == "coach" else ["player"], member_id),
        )
    return {"ok": True}


@api.delete("/members/{member_id}")
def delete_member(member_id: int, conn: DB, _admin: User):
    require_manageable_account(conn, member_id, _admin)
    member = conn.execute(
        "SELECT email FROM members WHERE id=%s AND role IN ('member','coach') FOR UPDATE", (member_id,),
    ).fetchone()
    if not member:
        raise HTTPException(404, "Člen sa nenašiel.")
    conn.execute("DELETE FROM participation WHERE member_id=%s", (member_id,))
    conn.execute("DELETE FROM messages WHERE sender_id=%s OR recipient_id=%s", (member_id, member_id))
    conn.execute("UPDATE battery_events SET actor_id=NULL WHERE actor_id=%s", (member_id,))
    conn.execute("DELETE FROM login_attempts WHERE email=%s", (member["email"],))
    conn.execute("DELETE FROM members WHERE id=%s", (member_id,))
    return {"ok": True}


def require_manageable_account(conn, member_id, user):
    row = conn.execute("SELECT role,club_roles FROM members WHERE id=%s AND role<>'superadmin' FOR UPDATE",
                       (member_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Člen sa nenašiel.")
    if row["role"] == "coach":
        require(user, "members.accounts.manage_staff")
    require_grantable_roles(conn, user, row["club_roles"] or [])


@api.post("/members/{member_id}/reset")
def reset_member_password(member_id: int, conn: DB, user: User):
    require_manageable_account(conn, member_id, user)
    token = secrets.token_urlsafe(32)
    member = conn.execute(
        """UPDATE members SET invite_hash=%s, invite_until=now() + interval '7 days'
        WHERE id=%s AND active AND (role='member' OR (role='coach' AND %s))
        AND password_hash IS NOT NULL RETURNING id""",
        (digest(token), member_id, access.allows(user, "members.accounts.manage_staff")),
    ).fetchone()
    if not member:
        raise HTTPException(404, "Aktívny účet sa nenašiel.")
    return {"invite_url": f"{PUBLIC_URL}/#invite={token}&reset=1"}


@api.post("/members/accept")
def accept(data: Accept, conn: DB):
    member = conn.execute(
        """SELECT id FROM members WHERE invite_hash = %s AND invite_until > now()
        AND active FOR UPDATE""", (digest(data.token),)
    ).fetchone()
    if not member:
        raise HTTPException(400, "Pozvánka je neplatná alebo už vypršala.")
    try:
        conn.execute("""UPDATE members SET email=%s,password_hash = %s, invite_hash = NULL, invite_until = NULL
            WHERE id = %s""", (data.email, password_hash(data.password), member["id"]))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "Tento e-mail už patrí existujúcemu účtu.") from None
    conn.execute("DELETE FROM sessions WHERE member_id = %s", (member["id"],))
    return {"ok": True}


@api.get("/members/invite-info/{token}")
def invite_info(token: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")], conn: DB):
    member = conn.execute("""SELECT email,name,club_roles FROM members WHERE invite_hash=%s
        AND invite_until>now() AND active""", (digest(token),)).fetchone()
    if not member:
        raise HTTPException(400, "Pozvánka je neplatná alebo už vypršala.")
    return {"email":member["email"],"name":member["name"],"roles":member["club_roles"]}


@api.put("/members/{member_id}/active")
def set_active(member_id: int, data: Active, conn: DB, user: User):
    require_manageable_account(conn, member_id, user)
    member = conn.execute(
        """UPDATE members SET active=%s WHERE id=%s
        AND (role='member' OR (role='coach' AND %s)) RETURNING id""",
        (data.active, member_id, access.allows(user, "members.accounts.manage_staff")),
    ).fetchone()
    if not member:
        raise HTTPException(404, "Člen sa nenašiel.")
    if not data.active:
        conn.execute("DELETE FROM sessions WHERE member_id = %s", (member_id,))
        conn.execute("UPDATE members SET invite_hash = NULL, invite_until = NULL WHERE id = %s",
                     (member_id,))
    return {"ok": True}


class Training(BaseModel):
    title: Short
    starts_at: AwareDatetime
    location: Short
    instructions: Note = ""
    weeks: int = Field(1, ge=1, le=26)
    kind: Literal["training", "match", "meeting"] = "training"
    ends_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_end(self):
        if self.ends_at is not None and self.ends_at <= self.starts_at:
            raise ValueError("Koniec musí nasledovať po začiatku.")
        return self


class TrainingEdit(Training):
    weeks: Literal[1] = 1
    expected_updated_at: AwareDatetime | None = None


class RSVP(BaseModel):
    response: Literal["yes", "no", "maybe"]
    note: Note = ""
    schedule_revision: int = Field(0, ge=0)


class Attendance(BaseModel):
    attended: bool


@api.get("/trainings")
def trainings(conn: DB, user: User):
    rows = conn.execute(
        """SELECT t.*, p.response, p.note, p.attended,
        CASE WHEN latest.schedule_revision = t.schedule_revision THEN latest.response END AS change_response,
        CASE WHEN latest.schedule_revision = t.schedule_revision THEN latest.note END AS change_note,
        coalesce(latest.response, p.response) AS last_response,
        t.created_by AS author_id,
        (SELECT json_build_object(
            'yes', count(*) FILTER (WHERE r.response='yes'),
            'no', count(*) FILTER (WHERE r.response='no'),
            'maybe', count(*) FILTER (WHERE r.response='maybe'),
            'unanswered', count(*) FILTER (WHERE r.response IS NULL),
            'attendance_pending', count(*) FILTER (WHERE r.attended IS NULL),
            'change_yes', count(*) FILTER (WHERE cr.response='yes'),
            'change_pending', count(*) FILTER (WHERE t.schedule_revision > 0 AND cr.response IS NULL))
         FROM members m LEFT JOIN participation r ON r.member_id=m.id AND r.training_id=t.id
         LEFT JOIN training_change_responses cr ON cr.training_id=t.id
           AND cr.schedule_revision=t.schedule_revision AND cr.member_id=m.id
         WHERE m.role IN ('member','coach') AND EXISTS (SELECT 1 FROM role_grants eligible WHERE eligible.role_key=ANY(m.club_roles)
                    AND eligible.permission IN ('calendar.rsvp.respond','calendar.rsvp.reconfirm'))
         AND m.active AND m.password_hash IS NOT NULL) AS counts
        FROM trainings t
        LEFT JOIN participation p ON p.training_id = t.id AND p.member_id = %s
        LEFT JOIN LATERAL (
            SELECT schedule_revision, response, note FROM training_change_responses
            WHERE training_id=t.id AND member_id=%s
            ORDER BY schedule_revision DESC LIMIT 1
        ) latest ON true
        ORDER BY (t.starts_at >= now()) DESC,
        CASE WHEN t.starts_at >= now() THEN t.starts_at END,
        t.starts_at DESC LIMIT 300""", (user["id"], user["id"]),
    ).fetchall()
    for row in rows:
        author = row.pop("author_id")
        own = author == user["id"]
        row["can_delete"] = access.allows(user, "calendar.events.delete_all") or (
            own and access.allows(user, "calendar.events.delete_own")) or (
            author is None and access.allows(user, "calendar.events.delete_unowned"))
        row["can_edit"] = access.allows(user, "calendar.events.edit_all") or (
            own and access.allows(user, "calendar.events.edit_own"))
        if not access.allows(user, "calendar.rsvp.summary"):
            row["counts"] = {key: count for key, count in row["counts"].items() if key == "attendance_pending"}
        if not access.allows(user, "attendance.records.read"):
            row["counts"].pop("attendance_pending", None)
        if not access.allows(user, "attendance.records.own"):
            row.pop("attended", None)
    return rows


@api.post("/trainings")
def create_training(data: Training, conn: DB, user: User):
    require(user, "calendar.events." + data.kind)
    return {"ok": True, "ids": insert_trainings(data, conn, user)}


def insert_trainings(data, conn, user):
    ids = []
    series = uuid4() if data.weeks > 1 else None
    start = data.starts_at.astimezone(CLUB_ZONE)
    starts = [start + timedelta(weeks=week) for week in range(data.weeks)]
    if any(
        stamp.astimezone(timezone.utc).astimezone(CLUB_ZONE).replace(tzinfo=None) != stamp.replace(tzinfo=None)
        or stamp.replace(fold=0).utcoffset() != stamp.replace(fold=1).utcoffset()
        for stamp in starts
    ):
        raise HTTPException(422, "Séria obsahuje nejednoznačný termín pri zmene času.")
    for stamp in starts:
        event = conn.execute(
            """INSERT INTO trainings (title, starts_at, location, instructions, series_id, kind, ends_at, created_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (data.title, stamp, data.location, data.instructions, series, data.kind,
             stamp.astimezone(timezone.utc) + (data.ends_at-data.starts_at) if data.ends_at else None, user["id"]),
        ).fetchone()
        ids.append(event["id"])
        push_service.enqueue(conn, None, "calendar", "Nová udalosť: " + data.title,
                             f"#page=calendar&event={event['id']}", event_id=event['id'], exclude=user['id'])
    return ids


def lock_training(conn, training_id):
    training = conn.execute("SELECT * FROM trainings WHERE id = %s FOR UPDATE",
                            (training_id,)).fetchone()
    if not training:
        raise HTTPException(404, "Udalosť sa nenašla.")
    return training


SCHEDULE_FIELDS = {"starts_at", "ends_at", "location"}


@api.put("/trainings/{training_id}")
def edit_training(training_id: int, data: TrainingEdit, conn: DB, staff_user: User):
    training = lock_training(conn, training_id)
    require_owner(staff_user, training, "calendar.events.edit")
    if training["kind"] != data.kind:
        require(staff_user, "calendar.events." + data.kind)
    if training["cancelled"]:
        raise HTTPException(409, "Udalosť bola zrušená.")
    if data.expected_updated_at is not None and training["updated_at"] != data.expected_updated_at:
        raise HTTPException(409, "Udalosť bola medzitým upravená. Otvor ju znova.")
    fields = ("title", "starts_at", "ends_at", "location", "instructions", "kind")
    changed_fields = [field for field in fields if training[field] != getattr(data, field)]
    if not changed_fields:
        return {"ok": True}
    schedule_changed = bool(SCHEDULE_FIELDS.intersection(changed_fields))
    revision = training["schedule_revision"] + int(schedule_changed)
    conn.execute(
        """UPDATE trainings SET title=%s, starts_at=%s, location=%s, instructions=%s,
        kind=%s, ends_at=%s, schedule_revision=%s, updated_at=clock_timestamp() WHERE id=%s""",
        (data.title, data.starts_at, data.location, data.instructions, data.kind, data.ends_at, revision, training_id),
    )
    serialized = data.model_dump(mode="json")
    changes = {field: {
        "before": training[field].isoformat() if isinstance(training[field], datetime) else training[field],
        "after": serialized[field],
    } for field in changed_fields}
    conn.execute(
        """INSERT INTO training_changes (training_id, schedule_revision, changed_by, changes)
        VALUES (%s,%s,%s,%s)""",
        (training_id, revision if schedule_changed else None, staff_user["id"], Jsonb(changes)),
    )
    notice = (f"Nový termín: {club_date(data.starts_at)} · {data.location}"
              + (f" · koniec {club_date(data.ends_at)}" if data.ends_at else "")
              + "\nV detaile udalosti môžeš potvrdiť zmenu."
              if schedule_changed and data.starts_at > datetime.now(timezone.utc)
              else "Podrobnosti úpravy nájdeš v histórii zmien udalosti.")
    conn.execute(
        "INSERT INTO announcements (title, body, event_id) VALUES (%s,%s,%s)",
        (f"Zmena udalosti: {data.title}", notice, training_id),
    )
    push_service.enqueue(conn, None, "calendar", "Zmena udalosti: " + data.title,
                         f"#page=calendar&event={training_id}", event_id=training_id)
    return {"ok": True}


@api.post("/trainings/{training_id}/cancel")
def cancel_training(training_id: int, conn: DB, _staff: User):
    training = lock_training(conn, training_id)
    if not training["cancelled"]:
        conn.execute("UPDATE trainings SET cancelled=true WHERE id=%s", (training_id,))
        conn.execute(
            "INSERT INTO announcements (title, body, event_id) VALUES (%s,%s,%s)",
            (f"Zrušená udalosť: {training['title']}",
             f"Termín {club_date(training['starts_at'])} · {training['location']} bol zrušený.", training_id),
        )
        push_service.enqueue(conn, None, "calendar", "Zrušená udalosť: " + training["title"],
                             f"#page=calendar&event={training_id}", event_id=training_id)
    return {"ok": True}


@api.delete("/trainings/{training_id}")
def delete_training(training_id: int, conn: DB, user: User):
    training = lock_training(conn, training_id)
    if not (training["created_by"] is None and access.allows(user, "calendar.events.delete_unowned")):
        require_owner(user, training, "calendar.events.delete")
    conn.execute("DELETE FROM trainings WHERE id=%s", (training_id,))
    return {"ok": True}


def club_date(timestamp):
    return timestamp.astimezone(CLUB_ZONE).strftime("%d/%m/%Y %H:%M")


@api.put("/trainings/{training_id}/rsvp")
def rsvp(training_id: int, data: RSVP, conn: DB, user: User):
    require(user, "calendar.rsvp.reconfirm" if data.schedule_revision else "calendar.rsvp.respond")
    training = lock_training(conn, training_id)
    if training["cancelled"] or training["starts_at"] <= datetime.now(timezone.utc):
        raise HTTPException(409, "Na túto udalosť sa už nedá prihlásiť.")
    if data.schedule_revision != training["schedule_revision"]:
        raise HTTPException(409, "Podmienky udalosti sa zmenili. Skontroluj aktuálny termín a miesto.")
    if data.schedule_revision:
        conn.execute(
            """INSERT INTO training_change_responses
            (training_id, schedule_revision, member_id, response, note) VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (training_id, schedule_revision, member_id)
            DO UPDATE SET response=excluded.response, note=excluded.note, responded_at=now()""",
            (training_id, data.schedule_revision, user["id"], data.response, data.note),
        )
        return {"ok": True}
    conn.execute(
        """INSERT INTO participation (training_id, member_id, response, note) VALUES (%s,%s,%s,%s)
        ON CONFLICT (training_id, member_id) DO UPDATE SET response=excluded.response, note=excluded.note""",
        (training_id, user["id"], data.response, data.note),
    )
    return {"ok": True}


@api.get("/trainings/{training_id}/changes")
def training_history(training_id: int, conn: DB, user: User):
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Udalosť sa nenašla.")
    return conn.execute(
        """SELECT c.id, c.changed_at, c.schedule_revision, c.changes,
        CASE WHEN m.role='coach' THEN m.name END AS editor,
        r.response, r.responded_at
        FROM training_changes c LEFT JOIN members m ON m.id=c.changed_by
        LEFT JOIN training_change_responses r ON r.training_id=c.training_id
          AND r.schedule_revision=c.schedule_revision AND r.member_id=%s
        WHERE c.training_id=%s ORDER BY c.id DESC""",
        (user["id"], training_id),
    ).fetchall()


@api.get("/trainings/{training_id}/roster")
def roster(training_id: int, conn: DB, _staff: User):
    require(_staff, "calendar.rsvp.roster", "attendance.records.read",
            "attendance.records.write", "attendance.records.bulk", "attendance.records.correct")
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Udalosť sa nenašla.")
    rows = conn.execute(
        """SELECT m.id, m.name, m.club_roles AS roles, m.avatar_version, p.response, p.note, p.attended,
        coalesce(r.versions, '{}'::jsonb) AS change_responses
        FROM trainings t CROSS JOIN members m
        LEFT JOIN participation p ON p.member_id=m.id AND p.training_id=t.id
        LEFT JOIN LATERAL (
            SELECT jsonb_object_agg(schedule_revision, jsonb_build_object(
                'response', response, 'note', note, 'responded_at', responded_at)) AS versions
            FROM training_change_responses WHERE training_id=t.id AND member_id=m.id
        ) r ON true
        WHERE t.id=%s AND m.role IN ('member','coach')
        AND ((EXISTS (SELECT 1 FROM role_grants eligible WHERE eligible.role_key=ANY(m.club_roles)
                    AND eligible.permission IN ('calendar.rsvp.respond','calendar.rsvp.reconfirm')) AND m.active AND m.password_hash IS NOT NULL)
             OR p.member_id IS NOT NULL OR r.versions IS NOT NULL)
        ORDER BY m.name, m.id""",
        (training_id,)
    ).fetchall()
    for row in rows:
        if not access.allows(_staff, "calendar.rsvp.roster"):
            for key in ("response", "note", "change_responses"):
                row.pop(key, None)
        if not any(access.allows(_staff, "attendance.records." + key)
                   for key in ("read", "write", "bulk", "correct")):
            row.pop("attended", None)
    return rows


@api.put("/trainings/{training_id}/attendance/{member_id}")
def attendance(training_id: int, member_id: int, data: Attendance, conn: DB, _staff: User):
    training = lock_training(conn, training_id)
    ends_at = training["ends_at"] or training["starts_at"] + timedelta(hours=3)
    if ends_at <= datetime.now(timezone.utc):
        require(_staff, "attendance.records.correct")
    if training["cancelled"] or training["starts_at"] > datetime.now(timezone.utc):
        raise HTTPException(409, "Dochádzku možno zapísať od začiatku udalosti.")
    if not conn.execute(
        """SELECT 1 FROM members m WHERE id=%s AND role IN ('member','coach') AND (
            EXISTS (SELECT 1 FROM role_grants eligible WHERE eligible.role_key=ANY(m.club_roles)
                    AND eligible.permission IN ('calendar.rsvp.respond','calendar.rsvp.reconfirm'))
            OR EXISTS (SELECT 1 FROM participation p WHERE p.member_id=m.id AND p.training_id=%s)
            OR EXISTS (SELECT 1 FROM training_change_responses r WHERE r.member_id=m.id AND r.training_id=%s))""",
        (member_id, training_id, training_id),
    ).fetchone():
        raise HTTPException(404, "Člen sa nenašiel.")
    conn.execute(
        """INSERT INTO participation (training_id, member_id, attended) VALUES (%s,%s,%s)
        ON CONFLICT (training_id, member_id) DO UPDATE SET attended=excluded.attended""",
        (training_id, member_id, data.attended),
    )
    return {"ok": True}


class BulkAttendance(BaseModel):
    member_ids: Annotated[list[int], Field(min_length=1, max_length=500)]
    attended: bool


@api.put("/trainings/{training_id}/attendance")
def bulk_attendance(training_id: int, data: BulkAttendance, conn: DB, _staff: User):
    training = lock_training(conn, training_id)
    ends_at = training["ends_at"] or training["starts_at"] + timedelta(hours=3)
    if ends_at <= datetime.now(timezone.utc):
        require(_staff, "attendance.records.correct")
    if training["cancelled"] or training["starts_at"] > datetime.now(timezone.utc):
        raise HTTPException(409, "Dochádzku možno zapísať od začiatku udalosti.")
    ids = set(data.member_ids)
    allowed = conn.execute(
        """SELECT id FROM members m WHERE id=ANY(%s) AND role IN ('member','coach') AND (
            EXISTS (SELECT 1 FROM role_grants eligible WHERE eligible.role_key=ANY(m.club_roles)
                    AND eligible.permission IN ('calendar.rsvp.respond','calendar.rsvp.reconfirm'))
            OR EXISTS (SELECT 1 FROM participation p WHERE p.member_id=m.id AND p.training_id=%s)
            OR EXISTS (SELECT 1 FROM training_change_responses r WHERE r.member_id=m.id AND r.training_id=%s))""",
        (list(ids), training_id, training_id),
    ).fetchall()
    if len(allowed) != len(ids):
        raise HTTPException(404, "Niektorý člen sa nenašiel.")
    with conn.cursor() as cursor:
        cursor.executemany(
            """INSERT INTO participation (training_id, member_id, attended) VALUES (%s,%s,%s)
            ON CONFLICT (training_id, member_id) DO UPDATE SET attended=excluded.attended""",
            [(training_id, member_id, data.attended) for member_id in ids],
        )
    return {"ok": True}


@api.get("/attendance")
def attendance_matrix(conn: DB, _staff: User, date_from: CalendarDate | None = None,
                      date_to: CalendarDate | None = None,
                      kinds: str = "training,match,meeting", include_cancelled: bool = False):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(422, "Dátum od nesmie byť neskôr než dátum do.")
    selected_kinds = kinds.split(",") if kinds else []
    if set(selected_kinds) - {"training", "match", "meeting"}:
        raise HTTPException(422, "Neplatný typ udalosti.")
    # Filter by club-local calendar dates, including the full final day across DST.
    events = conn.execute(
        """SELECT id,title,starts_at,ends_at,kind,cancelled FROM trainings
        WHERE kind=ANY(%s) AND (%s OR NOT cancelled)
        AND (%s::date IS NULL OR (starts_at AT TIME ZONE 'Europe/Bratislava')::date>=%s)
        AND (%s::date IS NULL OR (starts_at AT TIME ZONE 'Europe/Bratislava')::date<=%s)
        ORDER BY starts_at,id""",
        (selected_kinds, include_cancelled, date_from, date_from, date_to, date_to),
    ).fetchall()
    members = conn.execute(
        """SELECT id,name,active,club_roles AS roles FROM members m WHERE role IN ('member','coach') AND EXISTS (SELECT 1 FROM role_grants eligible WHERE eligible.role_key=ANY(m.club_roles)
                    AND eligible.permission IN ('calendar.rsvp.respond','calendar.rsvp.reconfirm')) ORDER BY lower(name),id"""
    ).fetchall()
    attendance = conn.execute(
        """SELECT p.training_id,p.member_id,p.attended FROM participation p
        JOIN members m ON m.id=p.member_id WHERE m.role IN ('member','coach') AND EXISTS (SELECT 1 FROM role_grants eligible WHERE eligible.role_key=ANY(m.club_roles)
                    AND eligible.permission IN ('calendar.rsvp.respond','calendar.rsvp.reconfirm'))
        AND p.training_id=ANY(%s) AND p.attended IS NOT NULL""",
        ([event["id"] for event in events],),
    ).fetchall()
    return {"events": events, "members": members, "attendance": attendance}


@api.get("/members/{member_id}/attendance")
def member_attendance(member_id: int, conn: DB, _staff: User):
    return conn.execute(
        """SELECT t.title, t.starts_at, p.attended FROM participation p
        JOIN trainings t ON t.id=p.training_id
        JOIN members m ON m.id=p.member_id AND m.role IN ('member','coach')
        WHERE p.member_id=%s AND p.attended IS NOT NULL ORDER BY t.starts_at DESC""",
        (member_id,)
    ).fetchall()


class ProposalOption(BaseModel):
    starts_at: AwareDatetime
    ends_at: AwareDatetime | None = None


class ProposalInput(BaseModel):
    title: Short
    location: Short
    instructions: Note = ""
    options: list[ProposalOption] = Field(min_length=1, max_length=8)


class ProposalEdit(ProposalInput):
    version: int = Field(gt=0)


class ProposalDecision(BaseModel):
    action: Literal["withdraw", "close", "reject", "approve"]
    option_id: int | None = Field(None, gt=0)
    version: int = Field(gt=0)


class ProposalVote(BaseModel):
    response: Literal["yes", "no", "maybe"]


def lock_proposal(conn, proposal_id):
    proposal = conn.execute("SELECT * FROM training_proposals WHERE id=%s FOR UPDATE", (proposal_id,)).fetchone()
    if proposal is None:
        raise HTTPException(404, "Návrh sa nenašiel.")
    return proposal


def validate_options(options):
    if len({item.starts_at for item in options}) != len(options) or any(
        item.starts_at <= datetime.now(timezone.utc)
        or (item.ends_at is not None and item.ends_at <= item.starts_at)
        for item in options
    ):
        raise HTTPException(422, "Vyber rôzne budúce termíny a skontroluj časy ukončenia.")


@api.get("/training-proposals")
def training_proposals(conn: DB, user: User):
    proposals = conn.execute("""SELECT p.*, m.name AS author
        FROM training_proposals p LEFT JOIN members m ON m.id=p.created_by ORDER BY p.id DESC LIMIT 150""").fetchall()
    index = {row["id"]: row for row in proposals}
    for row in proposals:
        row["options"] = []
    options = conn.execute("""SELECT o.*, own.response AS my_vote,
        (SELECT jsonb_object_agg(response, amount) FROM (
            SELECT response,count(*) AS amount FROM training_proposal_votes WHERE option_id=o.id GROUP BY response
        ) counts) AS results
        FROM training_proposal_options o LEFT JOIN training_proposal_votes own
          ON own.option_id=o.id AND own.member_id=%s
        WHERE o.proposal_id=ANY(%s) ORDER BY o.starts_at""", (user["id"], list(index))).fetchall()
    named = {}
    if access.allows(user, "calendar.proposals.voters"):
        for vote in conn.execute("""SELECT v.option_id,m.name,v.response FROM training_proposal_votes v
            JOIN members m ON m.id=v.member_id WHERE v.option_id=ANY(%s) ORDER BY m.name""",
            ([row["id"] for row in options],)).fetchall():
            named.setdefault(vote.pop("option_id"), []).append(vote)
    for option in options:
        if not access.allows(user, "calendar.proposals.results"):
            option.pop("results")
        if access.allows(user, "calendar.proposals.voters"):
            option["votes"] = named.get(option["id"], [])
        index[option["proposal_id"]]["options"].append(option)
    return proposals


@api.post("/training-proposals")
def create_training_proposal(data: ProposalInput, conn: DB, user: User):
    validate_options(data.options)
    proposal_id = conn.execute("""INSERT INTO training_proposals(title,location,instructions,created_by)
        VALUES (%s,%s,%s,%s) RETURNING id""", (data.title, data.location, data.instructions, user["id"])).fetchone()["id"]
    with conn.cursor() as cursor:
        cursor.executemany("""INSERT INTO training_proposal_options(proposal_id,starts_at,ends_at)
            VALUES (%s,%s,%s)""", [(proposal_id, item.starts_at, item.ends_at) for item in data.options])
    return {"id": proposal_id}


@api.put("/training-proposals/{proposal_id}")
def edit_training_proposal(proposal_id: int, data: ProposalEdit, conn: DB, user: User):
    proposal = lock_proposal(conn, proposal_id)
    if proposal["created_by"] != user["id"] and user["role"] != "superadmin":
        raise HTTPException(403, "Upraviť môžeš iba vlastný návrh.")
    if proposal["status"] != "open" or data.version != proposal["version"]:
        raise HTTPException(409, "Návrh sa zmenil alebo je uzavretý.")
    validate_options(data.options)
    options = {(item.starts_at, item.ends_at) for item in data.options}
    for row in conn.execute("SELECT * FROM training_proposal_options WHERE proposal_id=%s", (proposal_id,)).fetchall():
        key = (row["starts_at"], row["ends_at"])
        if key in options and proposal["location"] == data.location:
            options.remove(key)
        else:
            conn.execute("DELETE FROM training_proposal_options WHERE id=%s", (row["id"],))
    with conn.cursor() as cursor:
        cursor.executemany("""INSERT INTO training_proposal_options(proposal_id,starts_at,ends_at)
            VALUES (%s,%s,%s)""", [(proposal_id, starts_at, ends_at) for starts_at, ends_at in options])
    conn.execute("""UPDATE training_proposals SET title=%s,location=%s,instructions=%s,version=version+1 WHERE id=%s""",
                 (data.title, data.location, data.instructions, proposal_id))
    return {"ok": True}


@api.put("/training-proposals/{proposal_id}/options/{option_id}/vote")
def vote_training_proposal(proposal_id: int, option_id: int, data: ProposalVote, conn: DB, user: User):
    proposal = lock_proposal(conn, proposal_id)
    if proposal["status"] != "open":
        raise HTTPException(409, "Hlasovanie je uzavreté.")
    option = conn.execute("""SELECT 1 FROM training_proposal_options WHERE id=%s AND proposal_id=%s
        AND starts_at > now()""", (option_id, proposal_id)).fetchone()
    if option is None:
        raise HTTPException(409, "Termín sa zmenil alebo už uplynul.")
    conn.execute("""INSERT INTO training_proposal_votes(option_id,member_id,response) VALUES (%s,%s,%s)
        ON CONFLICT(option_id,member_id) DO UPDATE SET response=excluded.response""", (option_id, user["id"], data.response))
    return {"ok": True}


@api.post("/training-proposals/{proposal_id}/decision")
def update_training_proposal(proposal_id: int, data: ProposalDecision, conn: DB, user: User):
    permission = "edit" if data.action == "withdraw" else data.action
    require(user, "calendar.proposals." + permission)
    proposal = lock_proposal(conn, proposal_id)
    if data.action == "withdraw" and proposal["created_by"] != user["id"] and user["role"] != "superadmin":
        raise HTTPException(403, "Stiahnuť môžeš iba vlastný návrh.")
    if proposal["status"] not in ({"open", "closed"} if data.action in {"approve", "reject"} else {"open"}) or data.version != proposal["version"]:
        raise HTTPException(409, "Návrh sa zmenil alebo už bol vybavený.")
    training_id = None
    if data.action == "approve":
        option = conn.execute("""SELECT starts_at,ends_at FROM training_proposal_options
            WHERE proposal_id=%s AND id=%s AND starts_at>now()""", (proposal_id, data.option_id)).fetchone()
        if option is None:
            raise HTTPException(422, "Vyber budúci termín z návrhu.")
        training = Training(title=proposal["title"], location=proposal["location"],
                            instructions=proposal["instructions"], **option)
        training_id = insert_trainings(training, conn, user)[0]
    status = {"withdraw": "withdrawn", "close": "closed", "reject": "rejected", "approve": "approved"}[data.action]
    conn.execute("""UPDATE training_proposals SET status=%s,training_id=%s,version=version+1,
        decided_at=now(),decided_by=%s WHERE id=%s""", (status, training_id, user["id"], proposal_id))
    return {"training_id": training_id}


class DrillInput(BaseModel):
    title: Short
    objective: Note = ""
    duration_minutes: int = Field(10, ge=1, le=240)
    difficulty: Literal["basic", "intermediate", "advanced"] = "basic"
    equipment: Note = ""


class TrainingWorkspaceInput(BaseModel):
    plan: Annotated[list[dict], Field(max_length=40)] = []
    member_note: Annotated[str, StringConstraints(max_length=4000)] = ""
    coach_note: Annotated[str, StringConstraints(max_length=4000)] = ""


class TrainingFeedbackInput(BaseModel):
    went_well: Annotated[str, StringConstraints(max_length=1000)] = ""
    difficult: Annotated[str, StringConstraints(max_length=1000)] = ""
    next_focus: Annotated[str, StringConstraints(max_length=1000)] = ""


class Publication(BaseModel):
    published: bool


class NominationResponse(BaseModel):
    accepted: bool


class TrainingLineupInput(BaseModel):
    players: Annotated[list[dict], Field(max_length=40)] = []


def clean_lineup(conn, entries):
    players, seen, used_slots = [], set(), set()
    for entry in entries:
        try:
            member_id = int(entry.get("member_id"))
        except (TypeError, ValueError):
            continue
        if member_id in seen:
            continue
        seen.add(member_id)
        team = "A" if entry.get("team") == "A" else "B"
        position = str(entry.get("position", ""))[:40]
        substitute = bool(entry.get("substitute")) or position == "Substitute"
        try:
            slot = int(entry.get("slot")) if entry.get("slot") is not None else None
        except (TypeError, ValueError):
            slot = None
        if substitute:
            slot, position = None, "Substitute"
        else:
            if slot is None:
                role = "Striker" if position in {"Attacker", "Striker"} else "Defender"
                choices = (1, 2) if role == "Striker" else (3, 4, 5)
                slot = next((number for number in choices if (team, number) not in used_slots), None)
                if slot is None:
                    slot = next((number for number in range(1, 6) if (team, number) not in used_slots), None)
            if slot not in range(1, 6) or (team, slot) in used_slots:
                raise HTTPException(422, "Každá hráčska pozícia môže mať iba jedného hráča.")
            used_slots.add((team, slot))
            position = "Striker" if slot in (1, 2) else "Defender"
        players.append({"member_id": member_id, "team": team, "slot": slot,
                        "position": position, "substitute": substitute})
    valid_ids = {row["id"] for row in conn.execute(
        "SELECT id FROM members WHERE id=ANY(%s) AND role IN ('member','coach') AND 'player'=ANY(club_roles) AND active AND password_hash IS NOT NULL", (list(seen),)
    ).fetchall()} if seen else set()
    if seen != valid_ids:
        raise HTTPException(422, "Zostava obsahuje neaktívneho alebo neplatného člena.")
    return players


def club_lineup_players(conn, saved):
    if not saved or not saved["players"]:
        return []
    system_account = conn.execute("SELECT id FROM members WHERE role='superadmin'").fetchone()
    if not system_account:
        return saved["players"]
    return [player for player in saved["players"] if player.get("member_id") != system_account["id"]]


@api.get("/lineup/general")
def get_general_lineup(conn: DB, _user: User):
    saved = conn.execute("SELECT players FROM club_lineup WHERE id=1").fetchone()
    roster = conn.execute(
        """SELECT id,name,avatar_version,club_roles AS roles FROM members WHERE role IN ('member','coach') AND 'player'=ANY(club_roles) AND active AND password_hash IS NOT NULL
        ORDER BY lower(name),id"""
    ).fetchall()
    return {"players": club_lineup_players(conn, saved), "source": "general", "roster": roster}


@api.put("/lineup/general")
def save_general_lineup(data: TrainingLineupInput, conn: DB, user: User):
    players = clean_lineup(conn, data.players)
    conn.execute(
        """INSERT INTO club_lineup(id,players,updated_by) VALUES (1,%s,%s)
        ON CONFLICT(id) DO UPDATE SET players=excluded.players,updated_by=excluded.updated_by,updated_at=now()""",
        (Jsonb(players), user["id"]),
    )
    return {"ok": True}


@api.get("/lineup/events")
def lineup_events(conn: DB, _user: User):
    return conn.execute("""SELECT id,title,starts_at,kind,cancelled FROM trainings
        WHERE kind IN ('training','match') ORDER BY starts_at DESC LIMIT 300""").fetchall()


@api.get("/trainings/{training_id}/lineup")
def get_training_lineup(training_id: int, conn: DB, _user: User):
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Udalosť sa nenašla.")
    saved = conn.execute("SELECT players,published FROM training_lineups WHERE training_id=%s", (training_id,)).fetchone()
    general = conn.execute("SELECT players FROM club_lineup WHERE id=1").fetchone() if access.allows(_user, "team.lineup.club_read") else None
    may_view_draft = any(access.allows(_user, key) for key in ("team.lineup.event_edit", "team.lineup.publish"))
    draft = saved and not saved["published"]
    lineup = saved if saved and (not draft or may_view_draft) else general
    roster = conn.execute(
        """SELECT id,name,avatar_version,club_roles AS roles FROM members WHERE role IN ('member','coach') AND 'player'=ANY(club_roles) AND active AND password_hash IS NOT NULL
        ORDER BY lower(name),id"""
    ).fetchall()
    players = club_lineup_players(conn, lineup)
    nominated = bool(saved and saved["published"] and any(
        player.get("member_id") == _user["id"] for player in saved["players"]))
    response = conn.execute(
        "SELECT accepted FROM nomination_responses WHERE training_id=%s AND member_id=%s",
        (training_id, _user["id"]),
    ).fetchone() if nominated else None
    result = {"players": players, "source": "event" if lineup is not None and lineup is saved else "general",
              "roster": roster, "published": bool(saved and saved["published"]), "nominated": nominated,
              "my_response": response["accepted"] if response is not None else None}
    if access.allows(_user, "team.lineup.responses"):
        result["responses"] = conn.execute("""SELECT m.name,r.accepted FROM nomination_responses r
            JOIN members m ON m.id=r.member_id WHERE r.training_id=%s ORDER BY m.name""", (training_id,)).fetchall()
    return result


@api.put("/trainings/{training_id}/lineup")
def save_training_lineup(training_id: int, data: TrainingLineupInput, conn: DB, user: User):
    lock_training(conn, training_id)
    players = clean_lineup(conn, data.players)
    conn.execute(
        """INSERT INTO training_lineups(training_id,players,updated_by,published) VALUES (%s,%s,%s,%s)
        ON CONFLICT(training_id) DO UPDATE SET players=excluded.players,updated_by=excluded.updated_by,updated_at=now(),published=false""",
        (training_id, Jsonb(players), user["id"], False),
    )
    conn.execute("DELETE FROM nomination_responses WHERE training_id=%s", (training_id,))
    return {"ok": True}


@api.put("/trainings/{training_id}/lineup/publication")
def publish_training_lineup(training_id: int, data: Publication, conn: DB, _user: User):
    lock_training(conn, training_id)
    result = conn.execute("UPDATE training_lineups SET published=%s WHERE training_id=%s", (data.published, training_id))
    if not result.rowcount:
        raise HTTPException(404, "Ulož zostavu pred zverejnením.")
    return {"published": data.published}


@api.put("/trainings/{training_id}/lineup/response")
def respond_training_lineup(training_id: int, data: NominationResponse, conn: DB, user: User):
    training = lock_training(conn, training_id)
    if training["cancelled"] or training["starts_at"] <= datetime.now(timezone.utc):
        raise HTTPException(409, "Na túto nomináciu už nie je možné odpovedať.")
    lineup = conn.execute("SELECT players FROM training_lineups WHERE training_id=%s AND published",
                          (training_id,)).fetchone()
    if not lineup or not any(player.get("member_id") == user["id"] for player in lineup["players"]):
        raise HTTPException(404, "Nemáš nomináciu na túto udalosť.")
    conn.execute("""INSERT INTO nomination_responses(training_id,member_id,accepted) VALUES (%s,%s,%s)
        ON CONFLICT(training_id,member_id) DO UPDATE SET accepted=excluded.accepted,updated_at=now()""",
        (training_id, user["id"], data.accepted))
    return {"accepted": data.accepted}


class MemberCoachNoteInput(BaseModel):
    note: Annotated[str, StringConstraints(max_length=4000)] = ""


class MemberSkillInput(BaseModel):
    skill: Short
    level: int = Field(ge=0, le=4)
    note: Note = ""


@api.get("/drills")
def list_drills(conn: DB, _staff: User):
    return conn.execute("SELECT * FROM drills ORDER BY lower(title), id").fetchall()


@api.post("/drills")
def create_drill(data: DrillInput, conn: DB, user: User):
    return conn.execute(
        """INSERT INTO drills(title,objective,duration_minutes,difficulty,equipment,created_by)
        VALUES (%s,%s,%s,%s,%s,%s) RETURNING *""",
        (data.title, data.objective, data.duration_minutes, data.difficulty, data.equipment, user["id"]),
    ).fetchone()


@api.get("/trainings/{training_id}/workspace")
def training_workspace(training_id: int, conn: DB, user: User):
    require(user, *("calendar.workspace." + key for key in
                    ("read", "team_read", "private_read", "feedback_own", "feedback_all", "publish")))
    training = conn.execute("SELECT id FROM trainings WHERE id=%s", (training_id,)).fetchone()
    if not training:
        raise HTTPException(404, "Udalosť sa nenašla.")
    workspace = conn.execute(
        """SELECT plan,member_note,coach_note,published FROM training_workspace WHERE training_id=%s""",
        (training_id,),
    ).fetchone() or {"plan": [], "member_note": "", "coach_note": "", "published": False}
    see_draft = access.allows(user, "calendar.workspace.edit") or access.allows(user, "calendar.workspace.publish")
    if not access.allows(user, "calendar.workspace.read") or (not workspace["published"] and not see_draft):
        workspace.pop("plan")
    if not access.allows(user, "calendar.workspace.team_read"):
        workspace.pop("member_note")
    if not access.allows(user, "calendar.workspace.private_read"):
        workspace.pop("coach_note")
    if access.allows(user, "calendar.workspace.feedback_own"):
        workspace["own_feedback"] = conn.execute(
            """SELECT went_well,difficult,next_focus,updated_at FROM training_feedback
            WHERE training_id=%s AND member_id=%s""", (training_id, user["id"]),
        ).fetchone()
    if access.allows(user, "calendar.workspace.feedback_all"):
        workspace["feedback"] = conn.execute(
            """SELECT f.member_id,m.name,m.club_roles AS roles,f.went_well,f.difficult,f.next_focus,f.updated_at
            FROM training_feedback f JOIN members m ON m.id=f.member_id
            WHERE f.training_id=%s AND m.role IN ('member','coach') ORDER BY lower(m.name),m.id""", (training_id,),
        ).fetchall()
    return workspace


@api.put("/trainings/{training_id}/workspace")
def save_training_workspace(training_id: int, data: TrainingWorkspaceInput, conn: DB, user: User):
    if not data.model_fields_set:
        raise HTTPException(422, "Zadaj aspoň jednu zmenu plánu.")
    lock_training(conn, training_id)
    old = conn.execute("SELECT plan,member_note,coach_note FROM training_workspace WHERE training_id=%s",
                       (training_id,)).fetchone() or {"plan": [], "member_note": "", "coach_note": ""}
    fields = {"plan": "edit", "member_note": "team_edit", "coach_note": "private_edit"}
    for field in data.model_fields_set:
        require(user, "calendar.workspace." + fields[field])
    plan = []
    for item in data.plan:
        title = str(item.get("title", "")).strip()[:120]
        if title:
            try:
                duration = max(1, min(240, int(item.get("duration_minutes", 10))))
            except (TypeError, ValueError):
                duration = 10
            plan.append({"title": title, "duration_minutes": duration,
                         "notes": str(item.get("notes", ""))[:1000]})
    conn.execute(
        """INSERT INTO training_workspace(training_id,plan,member_note,coach_note,updated_by,published)
        VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT(training_id) DO UPDATE SET
        plan=excluded.plan,member_note=excluded.member_note,coach_note=excluded.coach_note,
        updated_by=excluded.updated_by,updated_at=now()""",
        (training_id, Jsonb(plan if "plan" in data.model_fields_set else old["plan"]),
         data.member_note if "member_note" in data.model_fields_set else old["member_note"],
         data.coach_note if "coach_note" in data.model_fields_set else old["coach_note"], user["id"],
         False),
    )
    return {"ok": True}


@api.put("/trainings/{training_id}/workspace/publication")
def publish_training_workspace(training_id: int, data: Publication, conn: DB, _user: User):
    lock_training(conn, training_id)
    result = conn.execute("UPDATE training_workspace SET published=%s WHERE training_id=%s",
                          (data.published, training_id))
    if not result.rowcount:
        raise HTTPException(404, "Najprv ulož tréningový plán.")
    return {"published": data.published}


@api.put("/trainings/{training_id}/feedback")
def save_training_feedback(training_id: int, data: TrainingFeedbackInput, conn: DB, user: User):
    eligible = conn.execute(
        """SELECT t.starts_at <= now() AS started, t.cancelled, p.attended
        FROM trainings t LEFT JOIN participation p ON p.training_id=t.id AND p.member_id=%s
        WHERE t.id=%s""", (user["id"], training_id),
    ).fetchone()
    if not eligible:
        raise HTTPException(404, "Udalosť sa nenašla.")
    if not eligible["started"] or eligible["cancelled"] or eligible["attended"] is not True:
        raise HTTPException(403, "Spätnú väzbu môže odovzdať iba prítomný člen po udalosti.")
    conn.execute(
        """INSERT INTO training_feedback(training_id,member_id,went_well,difficult,next_focus)
        VALUES (%s,%s,%s,%s,%s) ON CONFLICT(training_id,member_id) DO UPDATE SET
        went_well=excluded.went_well,difficult=excluded.difficult,next_focus=excluded.next_focus,
        updated_at=now()""",
        (training_id, user["id"], data.went_well, data.difficult, data.next_focus),
    )
    return {"ok": True}


@api.get("/development/players")
def development_players(conn: DB, _user: User):
    return conn.execute("""SELECT id,name,avatar_version,active,club_roles AS roles
        FROM members WHERE role IN ('member','coach') AND 'player'=ANY(club_roles) ORDER BY name,id""").fetchall()


@api.get("/members/{member_id}/development")
def member_development(member_id: int, conn: DB, _staff: User):
    if member_id == _staff["id"]:
        require(_staff, "development.skills.read", "development.skills.own")
    else:
        require(_staff, "development.skills.read")
    if not conn.execute("SELECT 1 FROM members WHERE id=%s AND role IN ('member','coach') AND 'player'=ANY(club_roles)", (member_id,)).fetchone():
        raise HTTPException(404, "Člen sa nenašiel.")
    note = conn.execute("SELECT note,updated_at FROM member_coach_notes WHERE member_id=%s", (member_id,)).fetchone()
    skills = conn.execute("SELECT skill,level,note,updated_at FROM member_skills WHERE member_id=%s ORDER BY lower(skill)", (member_id,)).fetchall()
    feedback = conn.execute(
        """SELECT t.id AS training_id,t.title,t.starts_at,f.went_well,f.difficult,f.next_focus,f.updated_at
        FROM training_feedback f JOIN trainings t ON t.id=f.training_id WHERE f.member_id=%s
        ORDER BY t.starts_at DESC LIMIT 30""", (member_id,),
    ).fetchall()
    return {"note": note["note"] if note and access.allows(_staff, "development.skills.private_read") else "",
            "skills": skills, "feedback": feedback if member_id == _staff["id"] or
            access.allows(_staff, "calendar.workspace.feedback_all") else []}


@api.put("/members/{member_id}/development/note")
def save_member_coach_note(member_id: int, data: MemberCoachNoteInput, conn: DB, user: User):
    if not conn.execute("SELECT 1 FROM members WHERE id=%s AND role IN ('member','coach') AND 'player'=ANY(club_roles)", (member_id,)).fetchone():
        raise HTTPException(404, "Člen sa nenašiel.")
    conn.execute(
        """INSERT INTO member_coach_notes(member_id,note,updated_by) VALUES (%s,%s,%s)
        ON CONFLICT(member_id) DO UPDATE SET note=excluded.note,updated_by=excluded.updated_by,updated_at=now()""",
        (member_id, data.note, user["id"]),
    )
    return {"ok": True}


@api.put("/members/{member_id}/development/skills")
def save_member_skill(member_id: int, data: MemberSkillInput, conn: DB, user: User):
    if not conn.execute("SELECT 1 FROM members WHERE id=%s AND role IN ('member','coach') AND 'player'=ANY(club_roles)", (member_id,)).fetchone():
        raise HTTPException(404, "Člen sa nenašiel.")
    conn.execute(
        """INSERT INTO member_skills(member_id,skill,level,note,updated_by) VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT(member_id,skill) DO UPDATE SET level=excluded.level,note=excluded.note,
        updated_by=excluded.updated_by,updated_at=now()""",
        (member_id, data.skill, data.level, data.note, user["id"]),
    )
    return {"ok": True}


class Announcement(BaseModel):
    published: bool = True
    title: Short
    body: Body
    pinned: bool = False
    audience: Literal["team", "coaches", "selected"] = "team"
    recipient_ids: Annotated[list[int], Field(max_length=1000)] = []
    notify: bool = True
    keep_attachment_ids: Annotated[list[int], Field(max_length=5)] = []
    draft_id: int | None = None


def notice_access(conn, announcement_id, user, *, lock=False, workbench=False):
    notice = conn.execute("SELECT * FROM announcements WHERE id=%s" + (" FOR UPDATE" if lock else ""),
                          (announcement_id,)).fetchone()
    if not notice or (not notice["published"] and not workbench):
        raise HTTPException(404, "Oznam sa nenašiel.")
    allowed = access.allows(user, "announcements.notices.read_all") or notice["audience"] == "team" or (notice["audience"] == "coaches" and access.allows(user, "announcements.notices.coaches")) or (notice["audience"] == "selected" and conn.execute(
        "SELECT 1 FROM announcement_recipients WHERE announcement_id=%s AND member_id=%s",
        (announcement_id,user["id"]),
    ).fetchone())
    if not allowed and not (workbench and not notice["published"] and
                            (notice["author_id"] == user["id"] or access.allows(user, "announcements.notices.edit"))):
        raise HTTPException(404, "Oznam sa nenašiel.")
    return notice


def notice_recipients(conn, data):
    if data.audience == "selected":
        ids = list(set(data.recipient_ids))
        valid = conn.execute(
            "SELECT id FROM members WHERE id=ANY(%s) AND active AND role IN ('member','coach')",
            (ids,),
        ).fetchall()
        if not ids or len(valid) != len(ids):
            raise HTTPException(422, "Vyber aktívnych členov alebo trénerov.")
        return ids
    return [r["id"] for r in conn.execute(
        """SELECT id FROM members WHERE active AND role IN ('member','coach') AND (%s='team' OR EXISTS (
            SELECT 1 FROM role_grants g WHERE g.role_key=ANY(members.club_roles)
            AND g.permission='announcements.notices.coaches'))""",
        (data.audience,),
    ).fetchall()]


def save_notice(conn, data, user, announcement_id=None):
    if data.published:
        require(user, "announcements.notices.publish")
    if data.published and data.notify:
        require(user, "announcements.notices.push")
    if announcement_id is not None:
        old = notice_access(conn, announcement_id, user, lock=True, workbench=True)
        if old["published"] and not data.published:
            raise HTTPException(409, "Zverejnený oznam nemôžeš vrátiť na koncept.")
        if old["event_id"] is not None:
            # Keep automatic calendar notices in their own notification category.
            channel = "calendar"
        else:
            channel = "announcements"
    else:
        channel = "announcements"
    previous_audience = old["audience"] if announcement_id is not None else "team"
    previous_ids = [row["member_id"] for row in conn.execute(
        "SELECT member_id FROM announcement_recipients WHERE announcement_id=%s", (announcement_id,)
    ).fetchall()] if announcement_id and previous_audience == "selected" else []
    if access.allows(user, "announcements.notices.audience"):
        ids = notice_recipients(conn, data)
    else:
        if data.audience != previous_audience or data.recipient_ids:
            require(user, "announcements.notices.audience")
        ids = previous_ids if previous_audience == "selected" else notice_recipients(conn, data)
    if data.pinned != (old["pinned"] if announcement_id is not None else False):
        require(user, "announcements.notices.pin")
    if data.draft_id is not None:
        require(user, "announcements.files.upload")
    if announcement_id is not None and not access.allows(user, "announcements.files.upload"):
        data.keep_attachment_ids = [row["id"] for row in conn.execute(
            "SELECT id FROM announcement_attachments WHERE announcement_id=%s", (announcement_id,)
        ).fetchall()]
    if announcement_id is None:
        announcement_id = conn.execute(
            "INSERT INTO announcements(title,body,pinned,audience,published,author_id) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
            (data.title,data.body,data.pinned,data.audience,data.published,user["id"]),
        ).fetchone()["id"]
    else:
        conn.execute("UPDATE announcements SET title=%s,body=%s,pinned=%s,audience=%s,published=%s,updated_at=now() WHERE id=%s",
                     (data.title,data.body,data.pinned,data.audience,data.published,announcement_id))
        conn.execute("DELETE FROM announcement_recipients WHERE announcement_id=%s", (announcement_id,))
        # Revoke queued/late push for the previous version and its old audience.
        conn.execute("DELETE FROM push_notifications WHERE announcement_id=%s", (announcement_id,))
        conn.execute("DELETE FROM announcement_reads WHERE announcement_id=%s", (announcement_id,))
    for member_id in ids:
        conn.execute("INSERT INTO announcement_recipients VALUES (%s,%s)", (announcement_id,member_id))
    conn.execute("DELETE FROM announcement_attachments WHERE announcement_id=%s AND NOT (id=ANY(%s))",
                 (announcement_id,data.keep_attachment_ids))
    if data.draft_id is not None:
        draft = conn.execute("SELECT * FROM announcement_drafts WHERE id=%s AND member_id=%s FOR UPDATE",
                              (data.draft_id,user["id"])).fetchone()
        if not draft:
            raise HTTPException(422, "Prílohy už nie sú dostupné, pridaj ich znova.")
        conn.execute("UPDATE announcement_attachments SET announcement_id=%s, draft_id=NULL WHERE draft_id=%s",
                     (announcement_id,data.draft_id))
        conn.execute("DELETE FROM announcement_drafts WHERE id=%s", (data.draft_id,))
    sizes = conn.execute("SELECT count(*) AS n,coalesce(sum(octet_length(content)),0) AS size FROM announcement_attachments WHERE announcement_id=%s",
                          (announcement_id,)).fetchone()
    if sizes["n"]>5 or sizes["size"]>5*1024*1024:
        raise HTTPException(413, "Najviac 5 príloh, spolu najviac 5 MB.")
    if data.published and data.notify:
        push_service.enqueue(conn, ids, channel, data.title, f"#page=announcements&notice={announcement_id}",
                             announcement_id=announcement_id)
    return {"ok":True,"id":announcement_id}


class Message(BaseModel):
    recipient_id: int | None = None
    group_id: int | None = None
    body: Body
    poll_options: list[Short] | None = None

    @model_validator(mode="after")
    def validate_destination(self):
        if (self.recipient_id is None) == (self.group_id is None):
            raise ValueError("Vyber jedného adresáta alebo jednu skupinu.")
        if self.poll_options is not None:
            if len(self.poll_options) < 2 or len({option.casefold() for option in self.poll_options}) != len(self.poll_options):
                raise ValueError("Anketa potrebuje aspoň dve rôzne možnosti.")
        return self


@api.get("/announcements")
def announcements(conn: DB, user: User):
    rows = conn.execute(
        """SELECT a.*, EXISTS (
            SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.member_id=%s
        ) AS is_read,
        ARRAY(SELECT member_id FROM announcement_recipients WHERE announcement_id=a.id) AS recipient_ids,
        COALESCE((SELECT json_agg(json_build_object('id',f.id,'filename',f.filename))
          FROM announcement_attachments f WHERE f.announcement_id=a.id),'[]') AS attachments
        FROM announcements a WHERE a.published AND (%s OR a.audience='team' OR (a.audience='coaches' AND %s) OR (a.audience='selected' AND EXISTS (
          SELECT 1 FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.member_id=%s)))
        ORDER BY a.pinned DESC, a.id DESC LIMIT 100""",
        (user["id"], access.allows(user, "announcements.notices.read_all"),
         access.allows(user, "announcements.notices.coaches"), user["id"]),
    ).fetchall()
    for row in rows:
        if not access.allows(user, "announcements.notices.audience"):
            row.pop("recipient_ids", None)
        if not access.allows(user, "announcements.files.read") and not access.allows(user, "announcements.files.upload"):
            row.pop("attachments", None)
    return rows


@api.get("/announcement-workbench")
def announcement_workbench(conn: DB, user: User):
    require(user, "announcements.notices.create", "announcements.notices.edit", "announcements.notices.publish")
    may_review = access.allows(user, "announcements.notices.edit") or access.allows(user, "announcements.notices.publish")
    rows = conn.execute("""SELECT a.*, ARRAY(SELECT member_id FROM announcement_recipients WHERE announcement_id=a.id) AS recipient_ids,
        COALESCE((SELECT json_agg(json_build_object('id',f.id,'filename',f.filename))
          FROM announcement_attachments f WHERE f.announcement_id=a.id),'[]') AS attachments
        FROM announcements a WHERE NOT a.published AND (%s OR a.author_id=%s) ORDER BY a.id DESC LIMIT 100""",
        (may_review, user["id"])).fetchall()
    for row in rows:
        if not access.allows(user, "announcements.notices.audience"):
            row.pop("recipient_ids", None)
        if not access.allows(user, "announcements.files.read") and not access.allows(user, "announcements.files.upload"):
            row.pop("attachments", None)
    return rows


class PublishAnnouncement(BaseModel):
    notify: bool = False


@api.post("/announcements/{announcement_id}/publish")
def publish_announcement(announcement_id: int, data: PublishAnnouncement, conn: DB, user: User):
    if data.notify:
        require(user, "announcements.notices.push")
    notice = conn.execute("""UPDATE announcements SET published=true,updated_at=now()
        WHERE id=%s AND NOT published RETURNING title,audience""", (announcement_id,)).fetchone()
    if notice is None:
        raise HTTPException(409, "Koncept sa nenašiel alebo už bol zverejnený.")
    if data.notify:
        if notice["audience"] == "selected":
            recipients = [row["member_id"] for row in conn.execute(
                "SELECT member_id FROM announcement_recipients WHERE announcement_id=%s", (announcement_id,)
            ).fetchall()]
        else:
            recipients = notice_recipients(conn, Announcement(title=notice["title"], body="-", audience=notice["audience"]))
        push_service.enqueue(conn, recipients, "announcements", notice["title"],
                             f"#page=announcements&notice={announcement_id}", announcement_id=announcement_id)
    return {"ok": True}


@api.post("/announcements")
def announce(data: Announcement, conn: DB, user: User):
    return save_notice(conn,data,user)


@api.put("/announcements/{announcement_id}")
def edit_announcement(announcement_id: int, data: Announcement, conn: DB, user: User):
    return save_notice(conn,data,user,announcement_id)


@api.delete("/announcements/{announcement_id}")
def delete_announcement(announcement_id: int, conn: DB, user: User):
    notice_access(conn,announcement_id,user,lock=True,workbench=True)
    conn.execute("DELETE FROM announcements WHERE id=%s", (announcement_id,))
    return {"ok":True}


@api.get("/announcement-recipients")
def announcement_contacts(conn: DB, _user: User):
    return conn.execute("SELECT id,name,role,club_roles AS roles FROM members WHERE active AND role IN ('member','coach') ORDER BY name,id").fetchall()


@api.post("/announcement-drafts")
def create_announcement_draft(conn: DB, user: User):
    conn.execute("DELETE FROM announcement_drafts WHERE created_at<now()-interval '1 day'")
    return conn.execute("INSERT INTO announcement_drafts(member_id) VALUES (%s) RETURNING id", (user["id"],)).fetchone()


@api.post("/announcement-drafts/{draft_id}/attachments")
async def upload_announcement_attachment(draft_id: int, request: Request, conn: DB, user: User):
    if not conn.execute("SELECT 1 FROM announcement_drafts WHERE id=%s AND member_id=%s FOR UPDATE",
                         (draft_id,user["id"])).fetchone():
        raise HTTPException(404,"Koncept sa nenašiel.")
    content=bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content)>5*1024*1024:
            raise HTTPException(413,"Prílohy môžu mať spolu najviac 5 MB.")
    sizes=conn.execute("SELECT count(*) AS n,coalesce(sum(octet_length(content)),0) AS size FROM announcement_attachments WHERE draft_id=%s",(draft_id,)).fetchone()
    if sizes["n"]>=5 or sizes["size"]+len(content)>5*1024*1024:
        raise HTTPException(413,"Najviac 5 príloh, spolu najviac 5 MB.")
    media = ('application/pdf' if content.startswith(b'%PDF-') else
             'image/png' if content.startswith(b'\x89PNG\r\n\x1a\n') else
             'image/jpeg' if content.startswith(b'\xff\xd8\xff') else None)
    if media is None:
        raise HTTPException(422,"Príloha musí byť PDF, PNG alebo JPEG.")
    try:
        filename=TypeAdapter(Short).validate_python(bytes.fromhex(request.headers.get('x-filename','')).decode())
    except (ValueError,UnicodeError):
        raise HTTPException(422,"Neplatný názov súboru.") from None
    return conn.execute("INSERT INTO announcement_attachments(draft_id,filename,media_type,content) VALUES (%s,%s,%s,%s) RETURNING id,filename",
                        (draft_id,filename,media,bytes(content))).fetchone()


@api.get("/announcements/{announcement_id}/attachments/{attachment_id}")
def download_announcement_attachment(announcement_id:int, attachment_id:int, conn:DB, user:User):
    notice_access(conn,announcement_id,user)
    item=conn.execute("SELECT * FROM announcement_attachments WHERE id=%s AND announcement_id=%s",(attachment_id,announcement_id)).fetchone()
    if not item:
        raise HTTPException(404,"Príloha sa nenašla.")
    from urllib.parse import quote
    return Response(bytes(item['content']),media_type=item['media_type'],
                    headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(item['filename'],safe='')})


class Pin(BaseModel):
    pinned: bool


@api.put("/announcements/{announcement_id}/pin")
def pin_announcement(announcement_id: int, data: Pin, conn: DB, _staff: User):
    if not conn.execute(
        "UPDATE announcements SET pinned=%s WHERE id=%s RETURNING id",
        (data.pinned, announcement_id),
    ).fetchone():
        raise HTTPException(404, "Oznam sa nenašiel.")
    return {"ok": True}


@api.post("/announcements/{announcement_id}/read")
def read_announcement(announcement_id: int, conn: DB, user: User):
    notice_access(conn,announcement_id,user)
    conn.execute(
        "INSERT INTO announcement_reads VALUES (%s,%s) ON CONFLICT DO NOTHING",
        (announcement_id, user["id"]),
    )
    return {"ok": True}


class Place(BaseModel):
    name: Short


@api.get("/places")
def places(conn: DB, _user: User):
    return conn.execute("SELECT * FROM places ORDER BY name").fetchall()


@api.post("/places")
def add_place(data: Place, conn: DB, _staff: User):
    conn.execute("INSERT INTO places (name) VALUES (%s) ON CONFLICT DO NOTHING", (data.name,))
    return {"ok": True}


@api.get("/documents")
def documents(conn: DB, _user: User):
    return conn.execute(
        """SELECT d.id,d.title,d.filename,d.created_at,d.requires_acknowledgement,
            EXISTS (SELECT 1 FROM document_acknowledgements a WHERE a.document_id=d.id AND a.member_id=%s)
              AS acknowledged FROM documents d ORDER BY d.id DESC""", (_user["id"],)
    ).fetchall()


@api.post("/documents")
async def upload_document(request: Request, conn: DB, _staff: User):
    # Read in bounded chunks even when Content-Length is missing.
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(413, "Dokument môže mať najviac 5 MB.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(422, "Vyber dokument vo formáte PDF.")
    title = request.headers.get("x-document-title", "")
    try:
        title = TypeAdapter(Short).validate_python(bytes.fromhex(title).decode("utf-8"))
    except (ValueError, UnicodeError):
        raise HTTPException(422, "Vyplň názov dokumentu.") from None
    conn.execute(
        "INSERT INTO documents (title, filename, content) VALUES (%s,%s,%s)",
        (title, "dokument.pdf", bytes(content)),
    )
    return {"ok": True}


@api.get("/documents/{document_id}/download")
def download_document(document_id: int, conn: DB, _user: User):
    document = conn.execute("SELECT content FROM documents WHERE id=%s", (document_id,)).fetchone()
    if not document:
        raise HTTPException(404, "Dokument sa nenašiel.")
    return Response(bytes(document["content"]), media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="dokument.pdf"'})


@api.delete("/documents/{document_id}")
def delete_document(document_id: int, conn: DB, _staff: User):
    conn.execute("DELETE FROM documents WHERE id=%s", (document_id,))
    return {"ok": True}


class DocumentAcknowledgementSetting(BaseModel):
    required: bool


@api.put("/documents/{document_id}/acknowledgement-settings")
def configure_document_ack(document_id: int, data: DocumentAcknowledgementSetting, conn: DB, _user: User):
    result = conn.execute("UPDATE documents SET requires_acknowledgement=%s WHERE id=%s",
                          (data.required, document_id))
    if not result.rowcount:
        raise HTTPException(404, "Dokument sa nenašiel.")
    return {"required": data.required}


@api.post("/documents/{document_id}/acknowledgement")
def acknowledge_document(document_id: int, conn: DB, user: User):
    document = conn.execute("SELECT requires_acknowledgement FROM documents WHERE id=%s FOR UPDATE",
                            (document_id,)).fetchone()
    if not document or not document["requires_acknowledgement"]:
        raise HTTPException(404, "Dokument nevyžaduje potvrdenie.")
    conn.execute("""INSERT INTO document_acknowledgements(document_id,member_id) VALUES (%s,%s)
        ON CONFLICT DO NOTHING""", (document_id, user["id"]))
    return {"ok": True}


@api.get("/documents/{document_id}/acknowledgements")
def list_document_ack(document_id: int, conn: DB, _user: User):
    return conn.execute("""SELECT m.id,m.name,a.created_at FROM document_acknowledgements a
        JOIN members m ON m.id=a.member_id WHERE a.document_id=%s ORDER BY m.name""", (document_id,)).fetchall()


def chat_user(user: User):
    return user


ChatUser = Annotated[dict, Depends(chat_user, scope="function")]


class ChatGroup(BaseModel):
    name: Short
    member_ids: Annotated[list[int], Field(min_length=1, max_length=500)]


class GroupRead(BaseModel):
    last_message_id: int = Field(ge=0)


def accessible_group(conn, group_id, user, lock=False):
    query = "SELECT * FROM chat_groups WHERE id=%s"
    if lock:
        query += " FOR UPDATE"
    group = conn.execute(query, (group_id,)).fetchone()
    if not group:
        raise HTTPException(404, "Skupina sa nenašla.")
    allowed = (
        user["role"] == "superadmin" or group["system_key"] == "team"
        or (group["system_key"] == "coaches" and access.allows(user, "messages.groups.coaches"))
        or (group["system_key"] is None and conn.execute(
            "SELECT 1 FROM chat_group_members WHERE group_id=%s AND member_id=%s",
            (group_id, user["id"]),
        ).fetchone())
    )
    if not allowed:
        raise HTTPException(404, "Skupina sa nenašla.")
    return group


def group_participants(conn, group):
    if group["system_key"]:
        return conn.execute(
            """SELECT id, name, role, avatar_version, club_roles AS roles FROM members WHERE active AND password_hash IS NOT NULL
            AND role IN ('member','coach') AND (%s OR EXISTS (
                SELECT 1 FROM role_grants g WHERE g.role_key=ANY(members.club_roles)
                AND g.permission='messages.groups.coaches')) ORDER BY name, id""",
            (group["system_key"] == "team",),
        ).fetchall()
    return conn.execute(
        """SELECT m.id, m.name, m.role, m.avatar_version, m.club_roles AS roles FROM chat_group_members gm
        JOIN members m ON m.id=gm.member_id WHERE gm.group_id=%s AND m.active
        AND m.password_hash IS NOT NULL AND m.role IN ('member', 'coach') ORDER BY m.name, m.id""",
        (group["id"],),
    ).fetchall()


def validate_group_members(conn, data, user):
    member_ids = set(data.member_ids) | {user["id"]}
    found = conn.execute(
        """SELECT id FROM members WHERE id=ANY(%s) AND active AND password_hash IS NOT NULL
        AND (role IN ('member', 'coach') OR (id=%s AND role='superadmin'))""", (list(member_ids), user["id"]),
    ).fetchall()
    if len(found) != len(member_ids):
        raise HTTPException(422, "Vyber aktívnych členov alebo trénerov.")
    if len(member_ids) < 2:
        raise HTTPException(422, "Vyber aspoň jedného ďalšieho účastníka.")
    return member_ids


@api.get("/conversations")
def conversations(conn: DB, user: ChatUser):
    private = conn.execute(
        """WITH inbox AS (
            SELECT p.*, CASE WHEN sender_id=%s THEN recipient_id ELSE sender_id END AS contact_id
            FROM messages p WHERE group_id IS NULL AND (sender_id=%s OR recipient_id=%s)
        ), recent AS (
            SELECT DISTINCT ON (contact_id) contact_id, body, created_at, id
            FROM inbox ORDER BY contact_id, id DESC
        )
        SELECT r.*, m.name, m.active, m.avatar_version, m.club_roles AS roles, 'private' AS type,
        (SELECT count(*) FROM messages WHERE sender_id=r.contact_id AND recipient_id=%s
         AND read_at IS NULL) AS unread
        FROM recent r JOIN members m ON m.id=r.contact_id
        ORDER BY r.id DESC""",
        (user["id"], user["id"], user["id"], user["id"]),
    ).fetchall()
    groups = conn.execute(
        """SELECT g.id AS group_id, g.name, g.system_key, true AS active, 'group' AS type,
        latest.id, latest.body, latest.created_at, author.name AS sender,
        (SELECT count(*) FROM messages p WHERE p.group_id=g.id AND p.sender_id<>%s
         AND p.id>COALESCE(gr.last_message_id, 0)) AS unread
        FROM chat_groups g
        LEFT JOIN chat_group_reads gr ON gr.group_id=g.id AND gr.member_id=%s
        LEFT JOIN LATERAL (
            SELECT id, body, created_at, sender_id FROM messages WHERE group_id=g.id
            ORDER BY id DESC LIMIT 1
        ) latest ON true
        LEFT JOIN members author ON author.id=latest.sender_id
        WHERE g.system_key='team' OR (g.system_key='coaches' AND %s)
        OR (g.system_key IS NULL AND EXISTS (
            SELECT 1 FROM chat_group_members gm WHERE gm.group_id=g.id AND gm.member_id=%s
        ))
        ORDER BY g.system_key IS NULL, latest.id DESC NULLS LAST, g.id""",
        (user["id"], user["id"], access.allows(user, "messages.groups.coaches"), user["id"]),
    ).fetchall()
    # Default rooms remain visible before their first message.
    return groups + private


@api.get("/contacts")
def contacts(conn: DB, user: ChatUser):
    require(user, "messages.chat.direct", "messages.groups.create", "messages.groups.edit")
    return conn.execute(
        """SELECT id, name, role, avatar_version, club_roles AS roles FROM members WHERE active AND password_hash IS NOT NULL
        AND role IN ('member', 'coach') AND id<>%s ORDER BY name, id""", (user["id"],),
    ).fetchall()


@api.get("/chat-groups/{group_id}")
def group_detail(group_id: int, conn: DB, user: ChatUser):
    group = accessible_group(conn, group_id, user)
    return {**group, "members": group_participants(conn, group),
            "can_manage": access.allows(user, "messages.groups.edit") and group["system_key"] is None}


@api.post("/chat-groups")
def create_group(data: ChatGroup, conn: DB, user: ChatUser):
    member_ids = validate_group_members(conn, data, user)
    group_id = conn.execute(
        "INSERT INTO chat_groups (name, created_by) VALUES (%s,%s) RETURNING id",
        (data.name, user["id"]),
    ).fetchone()["id"]
    with conn.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO chat_group_members VALUES (%s,%s)",
            [(group_id, member_id) for member_id in member_ids],
        )
    return {"group_id": group_id}


@api.put("/chat-groups/{group_id}")
def update_group(group_id: int, data: ChatGroup, conn: DB, user: ChatUser):
    group = accessible_group(conn, group_id, user, lock=True)
    if group["system_key"]:
        raise HTTPException(403, "Účastníci predvolených skupín sa určujú podľa rolí.")
    member_ids = validate_group_members(conn, data, user)
    conn.execute("UPDATE chat_groups SET name=%s WHERE id=%s", (data.name, group_id))
    conn.execute(
        "DELETE FROM chat_group_members WHERE group_id=%s AND NOT (member_id=ANY(%s))",
        (group_id, list(member_ids)),
    )
    # Removed users lose their read cursor too. Re-adding them restores the full history.
    conn.execute(
        "DELETE FROM chat_group_reads WHERE group_id=%s AND NOT (member_id=ANY(%s))",
        (group_id, list(member_ids)),
    )
    with conn.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO chat_group_members VALUES (%s,%s) ON CONFLICT DO NOTHING",
            [(group_id, member_id) for member_id in member_ids],
        )
    return {"ok": True}


def enrich_messages(conn, user, rows):
    if not rows:
        return rows
    by_id = {row["id"]: row for row in rows}
    for row in rows:
        row["reactions"] = []
        row["poll_results"] = []
    reactions = conn.execute(
        """SELECT r.message_id, r.emoji, count(*) AS count, bool_or(r.member_id=%s) AS mine
        FROM message_reactions r JOIN messages p ON p.id=r.message_id
        JOIN members m ON m.id=r.member_id
        WHERE r.message_id=ANY(%s) AND r.member_id<>p.sender_id
        GROUP BY r.message_id,r.emoji ORDER BY r.emoji""",
        (user["id"], list(by_id)),
    ).fetchall()
    votes = conn.execute(
        """SELECT message_id, choice, count(*) AS count, bool_or(member_id=%s) AS mine
        FROM message_poll_votes WHERE message_id=ANY(%s) GROUP BY message_id,choice ORDER BY choice""",
        (user["id"], list(by_id)),
    ).fetchall()
    for reaction in reactions:
        by_id[reaction.pop("message_id")]["reactions"].append(reaction)
    for vote in votes:
        by_id[vote.pop("message_id")]["poll_results"].append(vote)
    return rows


def interactive_message(conn, message_id, user, *, edit_options=False):
    lock = "FOR NO KEY UPDATE OF p" if edit_options else "FOR KEY SHARE OF p"
    row = conn.execute(
        """SELECT p.id,p.sender_id,p.recipient_id,p.group_id,p.poll_options
        FROM messages p JOIN members s ON s.id=p.sender_id
        LEFT JOIN members r ON r.id=p.recipient_id
        WHERE p.id=%s AND (p.group_id IS NOT NULL OR %s IN (p.sender_id,p.recipient_id)) """ + lock,
        (message_id, user["id"]),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Správa sa nenašla.")
    if row["group_id"] is not None:
        accessible_group(conn, row["group_id"], user)
    return row


ReactionEmoji = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32,
                                                  pattern=r"^[^\s]{1,32}$")]


class MessageReaction(BaseModel):
    emoji: ReactionEmoji
    active: bool


class PollVote(BaseModel):
    choice: Annotated[int, Field(ge=0)] | None


@api.put("/messages/{message_id}/reaction")
def update_reaction(message_id: int, data: MessageReaction, conn: DB, user: ChatUser):
    row = interactive_message(conn, message_id, user)
    if row["sender_id"] == user["id"] and data.active:
        raise HTTPException(403, "Na vlastnú správu nemôžeš reagovať.")
    values = (message_id, user["id"], data.emoji)
    if data.active:
        conn.execute(
            "INSERT INTO message_reactions (message_id,member_id,emoji) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
            values,
        )
    else:
        conn.execute("DELETE FROM message_reactions WHERE message_id=%s AND member_id=%s AND emoji=%s", values)
    return enrich_messages(conn, user, [row])[0]


@api.get("/messages/{message_id}/reactions")
def message_reactors(message_id: int, emoji: ReactionEmoji, conn: DB, user: ChatUser):
    row = interactive_message(conn, message_id, user)
    if row["sender_id"] != user["id"]:
        raise HTTPException(403, "Zoznam reakcií vidí iba autor správy.")
    return conn.execute(
        """SELECT m.id,m.name,m.avatar_version FROM message_reactions r JOIN members m ON m.id=r.member_id
        WHERE r.message_id=%s AND r.emoji=%s AND r.member_id<>%s
        ORDER BY lower(m.name),m.id""",
        (message_id, emoji, user["id"]),
    ).fetchall()


class AddedPollOption(BaseModel):
    option: Short


@api.post("/messages/{message_id}/poll-options")
def add_poll_option(message_id: int, data: AddedPollOption, conn: DB, user: ChatUser):
    row = interactive_message(conn, message_id, user, edit_options=True)
    options = row["poll_options"]
    if options is None:
        raise HTTPException(422, "Táto správa nie je anketa.")
    if any(option.casefold() == data.option.casefold() for option in options):
        raise HTTPException(409, "Táto možnosť už v ankete je.")
    # Append only so existing votes keep pointing to the same options.
    options.append(data.option)
    conn.execute("UPDATE messages SET poll_options=%s WHERE id=%s", (Jsonb(options), message_id))
    return enrich_messages(conn, user, [row])[0]


@api.put("/messages/{message_id}/vote")
def vote_in_poll(message_id: int, data: PollVote, conn: DB, user: ChatUser):
    row = interactive_message(conn, message_id, user)
    if row["poll_options"] is None or (data.choice is not None and data.choice >= len(row["poll_options"])):
        raise HTTPException(422, "Vyber platnú možnosť ankety.")
    if data.choice is None:
        conn.execute("DELETE FROM message_poll_votes WHERE message_id=%s AND member_id=%s",
                     (message_id, user["id"]))
    else:
        conn.execute(
            """INSERT INTO message_poll_votes (message_id,member_id,choice) VALUES (%s,%s,%s)
            ON CONFLICT (message_id,member_id) DO UPDATE SET choice=excluded.choice""",
            (message_id, user["id"], data.choice),
        )
    return enrich_messages(conn, user, [row])[0]


@api.get("/messages")
def messages(conn: DB, user: ChatUser, before: int | None = None,
             contact_id: int | None = None, group_id: int | None = None):
    if group_id is not None:
        if contact_id is not None:
            raise HTTPException(422, "Vyber jednu konverzáciu.")
        accessible_group(conn, group_id, user)
        rows = conn.execute(
            """SELECT p.*, s.name AS sender, s.avatar_version AS sender_avatar_version, s.club_roles AS sender_roles
            FROM messages p JOIN members s ON s.id=p.sender_id
            WHERE p.group_id=%s AND p.id<%s ORDER BY p.id DESC LIMIT 200""",
            (group_id, before or 9223372036854775807),
        ).fetchall()
        return enrich_messages(conn, user, rows)
    rows = conn.execute(
        """SELECT p.*, s.name AS sender, s.avatar_version AS sender_avatar_version, r.name AS recipient FROM messages p
        JOIN members s ON s.id=p.sender_id JOIN members r ON r.id=p.recipient_id
        WHERE p.group_id IS NULL AND (sender_id=%s OR recipient_id=%s) AND p.id < %s
        AND (%s::bigint IS NULL OR sender_id=%s OR recipient_id=%s)
        ORDER BY p.id DESC LIMIT 200""",
        (user["id"], user["id"], before or 9223372036854775807, contact_id, contact_id, contact_id),
    ).fetchall()
    return enrich_messages(conn, user, rows)


@api.post("/messages")
def send_message(data: Message, conn: DB, user: ChatUser):
    require(user, "messages.chat.send_group" if data.group_id is not None else "messages.chat.direct")
    if data.poll_options is not None:
        require(user, "messages.poll.create")
    options = Jsonb(data.poll_options) if data.poll_options is not None else None
    if data.group_id is not None:
        accessible_group(conn, data.group_id, user, lock=True)
        message = conn.execute(
            "INSERT INTO messages (sender_id, group_id, body, poll_options) VALUES (%s,%s,%s,%s) RETURNING id",
            (user["id"], data.group_id, data.body, options),
        ).fetchone()
    else:
        target = conn.execute(
            """SELECT id FROM members WHERE id=%s AND id<>%s AND active
            AND password_hash IS NOT NULL AND (role<>'superadmin' OR EXISTS (
                SELECT 1 FROM messages WHERE sender_id=members.id AND recipient_id=%s AND group_id IS NULL))
            """, (data.recipient_id, user["id"], user["id"]),
        ).fetchone()
        if not target:
            raise HTTPException(404, "Adresát sa nenašiel.")
        message = conn.execute(
            "INSERT INTO messages (sender_id, recipient_id, body, poll_options) VALUES (%s,%s,%s,%s) RETURNING id",
            (user["id"], target["id"], data.body, options),
        ).fetchone()
    if data.group_id is not None:
        group=accessible_group(conn,data.group_id,user)
        recipients=[p['id'] for p in group_participants(conn,group)]
        path=f"#page=messages&group={data.group_id}"
        title=f"{group['name']}: nová správa od {user['name']}"
    else:
        recipients=[data.recipient_id]
        path=f"#page=messages&contact={user['id']}"
        title=f"Nová správa od {user['name']}"
    push_service.enqueue(conn,recipients,'messages',title,path,message_id=message['id'],exclude=user['id'])
    return {"ok": True, "id": message["id"]}


@api.post("/messages/read")
def read_messages(ids: Annotated[list[int], Field(max_length=200)], conn: DB, user: ChatUser):
    conn.execute(
        "UPDATE messages SET read_at=now() WHERE recipient_id=%s AND id=ANY(%s) AND read_at IS NULL",
        (user["id"], ids),
    )
    return {"ok": True}


@api.post("/chat-groups/{group_id}/read")
def read_group(group_id: int, data: GroupRead, conn: DB, user: ChatUser):
    accessible_group(conn, group_id, user, lock=True)
    # Bound the cursor by an existing message so a client cannot skip future unread messages.
    last_id = conn.execute(
        "SELECT COALESCE(max(id), 0) AS id FROM messages WHERE group_id=%s AND id<=%s",
        (group_id, data.last_message_id),
    ).fetchone()["id"]
    conn.execute(
        """INSERT INTO chat_group_reads VALUES (%s,%s,%s)
        ON CONFLICT (group_id, member_id) DO UPDATE
        SET last_message_id=greatest(chat_group_reads.last_message_id, excluded.last_message_id)""",
        (group_id, user["id"], last_id),
    )
    return {"ok": True}


class Battery(BaseModel):
    code: Code
    label: Short


class BatteryEvent(BaseModel):
    request_id: UUID | None = None
    action: Literal["used", "charged", "discharged", "stored", "storage_exit", "damaged", "retired", "note"]
    note: Note = ""


@api.get("/batteries")
def batteries(conn: DB, _user: User):
    return conn.execute(
        """SELECT b.*,
        (SELECT CASE WHEN action='used' THEN 'in_drone' ELSE action END FROM battery_events WHERE code=b.code
          AND action IN ('used','charged','discharged','stored','storage_exit','damaged','retired')
          ORDER BY id DESC LIMIT 1) AS status,
        (SELECT created_at FROM battery_events WHERE code=b.code
          AND action IN ('used','charged','discharged','stored','storage_exit','damaged','retired')
          ORDER BY id DESC LIMIT 1) AS status_at,
        (SELECT count(*) FROM battery_events WHERE code=b.code AND action='charged') AS charges
        FROM batteries b ORDER BY b.code"""
    ).fetchall()


@api.get("/batteries/timeline")
def battery_timeline(end: CalendarDate, conn: DB, _user: User):
    if end < CalendarDate(1900, 1, 7) or end == CalendarDate.max:
        raise HTTPException(422, "Neplatný dátum.")
    start = datetime.combine(end, datetime.min.time(), tzinfo=CLUB_ZONE)
    return conn.execute(
        """SELECT e.id,e.code,e.action,e.note,e.created_at,
        CASE WHEN m.role='superadmin' THEN 'Systém'
        ELSE COALESCE(m.name, 'Odstránený účet') END AS name
        FROM battery_events e LEFT JOIN members m ON m.id=e.actor_id
        WHERE e.created_at >= %s AND e.created_at < %s
        ORDER BY e.created_at DESC,e.id DESC""",
        (start - timedelta(days=6), start + timedelta(days=1)),
    ).fetchall()


@api.post("/batteries")
def add_battery(data: Battery, conn: DB, _staff: User):
    result = conn.execute("INSERT INTO batteries VALUES (%s,%s) ON CONFLICT DO NOTHING",
                          (data.code, data.label))
    if not result.rowcount:
        raise HTTPException(409, "Batéria s týmto kódom už existuje.")
    return {"ok": True}


@api.get("/batteries/{code}/events")
def events(code: Code, conn: DB, _user: User):
    return conn.execute(
        """SELECT e.id,e.code,e.action,e.note,e.created_at,e.request_id,
        CASE WHEN m.role<>'superadmin' THEN e.actor_id END AS actor_id,
        CASE WHEN m.role='superadmin' THEN 'Systém'
        ELSE COALESCE(m.name, 'Odstránený účet') END AS name
        FROM battery_events e LEFT JOIN members m ON m.id=e.actor_id
        WHERE code=%s ORDER BY e.id DESC LIMIT 100""", (code,)
    ).fetchall()


@api.delete("/batteries/{code}/events/{event_id}")
def delete_battery_event(code: Code, event_id: int, conn: DB, user: User):
    result = conn.execute("DELETE FROM battery_events WHERE code=%s AND id=%s", (code, event_id))
    if not result.rowcount:
        raise HTTPException(404, "Záznam sa nenašiel.")
    return {"ok": True}


@api.post("/batteries/{code}/events")
def add_event(code: Code, data: BatteryEvent, conn: DB, user: User):
    require(user, "equipment.battery." + data.action)
    if not conn.execute("SELECT 1 FROM batteries WHERE code=%s FOR UPDATE", (code,)).fetchone():
        raise HTTPException(404, "Batéria sa nenašla.")
    if data.request_id is not None:
        previous = conn.execute("SELECT code,actor_id,action,note FROM battery_events WHERE request_id=%s", (data.request_id,)).fetchone()
        if previous:
            if (previous["code"],previous["actor_id"],previous["action"],previous["note"]) != (code,user["id"],data.action,data.note):
                raise HTTPException(409, "Identifikátor záznamu už bol použitý.")
            return {"ok": True}
    last = conn.execute("SELECT CASE WHEN action='used' THEN 'in_drone' ELSE action END AS action FROM battery_events WHERE code=%s AND action IN ('used','charged','discharged','stored','storage_exit','damaged','retired') ORDER BY id DESC LIMIT 1",
                        (code,)).fetchone()
    status = last["action"] if last else None
    if (status == "retired" and data.action != "note") or (status == "damaged" and data.action not in {"damaged", "retired", "note"}):
        raise HTTPException(409, "Batéria je poškodená alebo vyradená.")
    if data.action == "storage_exit" and status != "stored":
        raise HTTPException(409, "Batéria nie je označená ako uložená v dlhodobom sklade.")
    # A stable request id makes retrying a scanned action safe after a lost response.
    inserted = conn.execute(
        """INSERT INTO battery_events (code,actor_id,action,note,request_id) VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING""",
        (code,user["id"],data.action,data.note,data.request_id),
    )
    if not inserted.rowcount:
        raise HTTPException(409, "Identifikátor záznamu už bol použitý.")
    return {"ok": True}


class EquipmentAssetInput(BaseModel):
    code: EquipmentCode
    kind: Literal["controller", "drone", "charger"]
    label: Short

    @model_validator(mode="after")
    def prefix_matches_kind(self):
        expected = {"controller": "LF-C", "drone": "LF-D", "charger": "LF-X"}[self.kind]
        if not self.code.startswith(expected):
            raise ValueError("Kód zariadenia nezodpovedá jeho typu.")
        return self


class EquipmentEventInput(BaseModel):
    action: Literal["assigned", "returned", "inspection", "training", "fault", "repair", "maintenance",
                    "propeller_replacement", "motor_replacement", "battery_check", "retired", "note"]
    member_id: int | None = Field(None, gt=0)
    note: Note = ""


@api.get("/equipment/assets")
def equipment_assets(conn: DB, _user: User):
    return conn.execute(
        """SELECT a.code,a.kind,a.label,a.created_at,e.action AS status,e.created_at AS status_at,
        CASE WHEN %s OR (%s AND c.member_id=%s) THEN m.name END AS assigned_member_name,
        l.status AS loan_status,
        CASE WHEN %s OR (%s AND l.member_id=%s) THEN borrower.name END AS loan_member_name
        FROM equipment_assets a LEFT JOIN LATERAL (
            SELECT action,created_at FROM equipment_events WHERE code=a.code
            AND action NOT IN ('note','assigned','returned') ORDER BY id DESC LIMIT 1
        ) e ON true LEFT JOIN equipment_current_assignment c ON c.code=a.code AND c.action='assigned'
        LEFT JOIN members m ON m.id=c.member_id
        LEFT JOIN equipment_loans l ON l.code=a.code AND l.status IN ('pending','accepted')
        LEFT JOIN members borrower ON borrower.id=l.member_id ORDER BY a.kind,a.code""",
        (access.allows(_user, "equipment.loans.read"), access.allows(_user, "equipment.loans.own"), _user["id"],
         access.allows(_user, "equipment.loans.read"), access.allows(_user, "equipment.loans.own"), _user["id"]),
    ).fetchall()


@api.post("/equipment/assets")
def add_equipment_asset(data: EquipmentAssetInput, conn: DB, _staff: User):
    result = conn.execute("INSERT INTO equipment_assets(code,kind,label) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                          (data.code, data.kind, data.label))
    if not result.rowcount:
        raise HTTPException(409, "Zariadenie s týmto kódom už existuje.")
    return {"ok": True}


@api.get("/equipment/assets/{code}/events")
def equipment_asset_events(code: EquipmentCode, conn: DB, _user: User):
    if not conn.execute("SELECT 1 FROM equipment_assets WHERE code=%s", (code,)).fetchone():
        raise HTTPException(404, "Zariadenie sa nenašlo.")
    return conn.execute(
        """SELECT e.id,e.code,e.action,e.note,e.created_at,
        CASE WHEN actor.role='superadmin' THEN 'Systém' ELSE COALESCE(actor.name,'Odstránený účet') END AS name,
        CASE WHEN %s OR (%s AND e.member_id=%s) THEN assigned.name END AS assigned_member_name
        FROM equipment_events e LEFT JOIN members actor ON actor.id=e.actor_id
        LEFT JOIN members assigned ON assigned.id=e.member_id
        WHERE e.code=%s ORDER BY e.id DESC LIMIT 100""",
        (access.allows(_user, "equipment.loans.read"), access.allows(_user, "equipment.loans.own"), _user["id"], code),
    ).fetchall()


@api.post("/equipment/assets/{code}/events")
def add_equipment_event(code: EquipmentCode, data: EquipmentEventInput, conn: DB, user: User):
    key = {"assigned": "equipment.loans.assign", "returned": "equipment.loans.unassign"}.get(
        data.action, "equipment.service." + data.action)
    require(user, key)
    asset = conn.execute("SELECT kind FROM equipment_assets WHERE code=%s FOR UPDATE", (code,)).fetchone()
    if not asset:
        raise HTTPException(404, "Zariadenie sa nenašlo.")
    if data.action in {"propeller_replacement", "motor_replacement"} and asset["kind"] != "drone":
        raise HTTPException(422, "Výmena vrtúľ alebo motorov sa eviduje iba pri dronoch.")
    if data.action == "battery_check" and asset["kind"] != "controller":
        raise HTTPException(422, "Kontrola batérie ovládača sa eviduje iba pri ovládačoch.")
    if data.action == "assigned":
        if data.member_id is None:
            raise HTTPException(422, "Pri pridelení vyber člena.")
        if not conn.execute("SELECT 1 FROM members WHERE id=%s AND role IN ('member','coach') AND active AND password_hash IS NOT NULL", (data.member_id,)).fetchone():
            raise HTTPException(422, "Vybraný člen nemá aktívny účet.")
    elif data.member_id is not None:
        raise HTTPException(422, "Člen sa vyberá iba pri pridelení zariadenia.")
    if data.action in {"assigned", "retired"} and conn.execute(
        "SELECT 1 FROM equipment_loans WHERE code=%s AND status IN ('pending','accepted')", (code,)
    ).fetchone():
        raise HTTPException(409, "Zariadenie má otvorenú zápožičku.")
    if data.action != "note":
        last = conn.execute("""SELECT action FROM equipment_events WHERE code=%s
            AND action NOT IN ('note','assigned','returned') ORDER BY id DESC LIMIT 1""", (code,)).fetchone()
        if last and last["action"] == "retired":
            raise HTTPException(409, "Zariadenie je vyradené.")
    conn.execute("INSERT INTO equipment_events(code,actor_id,action,member_id,note) VALUES (%s,%s,%s,%s,%s)",
                  (code, user["id"], data.action, data.member_id, data.note))
    return {"ok": True}


class EquipmentLabel(BaseModel):
    label: Short


class EquipmentLoanInput(BaseModel):
    member_id: int = Field(gt=0)
    due_at: AwareDatetime | None = None


class EquipmentLoanAction(BaseModel):
    action: Literal["accept", "return", "cancel"]


def set_equipment_label(conn, table, code, label):
    # Only table names from these two static routes are accepted.
    result = conn.execute(f"UPDATE {table} SET label=%s WHERE code=%s", (label, code))
    if not result.rowcount:
        raise HTTPException(404, "Zariadenie sa nenašlo.")
    return {"ok": True}


@api.put("/equipment/assets/{code}")
def edit_equipment_asset(code: EquipmentCode, data: EquipmentLabel, conn: DB, _user: User):
    return set_equipment_label(conn, "equipment_assets", code, data.label)


@api.put("/batteries/{code}")
def edit_battery(code: Code, data: EquipmentLabel, conn: DB, _user: User):
    return set_equipment_label(conn, "batteries", code, data.label)


@api.get("/equipment/loan-members")
def loan_members(conn: DB, user: User):
    require(user, *("equipment.loans." + key for key in ("assign", "drone", "controller", "charger")))
    return conn.execute("""SELECT id,name FROM members WHERE active AND password_hash IS NOT NULL
        AND role IN ('member','coach') ORDER BY name,id""").fetchall()


@api.get("/equipment/assets/{code}/loans")
def equipment_loans(code: EquipmentCode, conn: DB, user: User):
    require(user, "equipment.loans.read", "equipment.loans.own", "equipment.loans.accept",
            "equipment.loans.return", "equipment.loans.cancel")
    return conn.execute("""SELECT l.*,m.name AS member_name FROM equipment_loans l
        LEFT JOIN members m ON m.id=l.member_id WHERE l.code=%s AND (%s OR l.member_id=%s)
        ORDER BY l.id DESC LIMIT 100""",
        (code, any(access.allows(user, "equipment.loans." + key) for key in ("read","return","cancel")), user["id"])).fetchall()


def lock_asset(conn, code):
    asset = conn.execute("SELECT * FROM equipment_assets WHERE code=%s FOR UPDATE", (code,)).fetchone()
    if asset is None:
        raise HTTPException(404, "Zariadenie sa nenašlo.")
    return asset


@api.post("/equipment/assets/{code}/loans")
def create_equipment_loan(code: EquipmentCode, data: EquipmentLoanInput, conn: DB, user: User):
    asset = lock_asset(conn, code)
    require(user, "equipment.loans." + asset["kind"])
    custody = conn.execute("SELECT action FROM equipment_current_assignment WHERE code=%s", (code,)).fetchone()
    if custody and custody["action"] in {"assigned", "retired"}:
        raise HTTPException(409, "Zariadenie je pridelené alebo vyradené.")
    if not conn.execute("""SELECT 1 FROM members WHERE id=%s AND active AND password_hash IS NOT NULL
        AND role IN ('member','coach') FOR KEY SHARE""", (data.member_id,)).fetchone():
        raise HTTPException(422, "Vybraný člen nemá aktívny účet.")
    if data.due_at and data.due_at <= datetime.now(timezone.utc):
        raise HTTPException(422, "Termín vrátenia musí byť v budúcnosti.")
    loan = conn.execute("""INSERT INTO equipment_loans(code,member_id,created_by,due_at)
        VALUES (%s,%s,%s,%s) ON CONFLICT (code) WHERE status IN ('pending','accepted')
        DO NOTHING RETURNING id""", (code, data.member_id, user["id"], data.due_at)).fetchone()
    if loan is None:
        raise HTTPException(409, "Zariadenie už má otvorenú zápožičku.")
    return loan


@api.put("/equipment/assets/{code}/loans/{loan_id}")
def update_equipment_loan(code: EquipmentCode, loan_id: int, data: EquipmentLoanAction, conn: DB, user: User):
    require(user, "equipment.loans." + data.action)
    lock_asset(conn, code)
    loan = conn.execute("SELECT * FROM equipment_loans WHERE id=%s AND code=%s FOR UPDATE", (loan_id, code)).fetchone()
    if loan is None or (data.action == "accept" and loan["member_id"] != user["id"]):
        raise HTTPException(404, "Zápožička sa nenašla.")
    expected = "accepted" if data.action == "return" else "pending"
    if loan["status"] != expected:
        raise HTTPException(409, "Zápožička už zmenila stav.")
    if data.action == "accept":
        conn.execute("UPDATE equipment_loans SET status='accepted',accepted_at=now() WHERE id=%s", (loan_id,))
    else:
        status = "returned" if data.action == "return" else "cancelled"
        conn.execute("UPDATE equipment_loans SET status=%s,closed_by=%s,closed_at=now() WHERE id=%s",
                     (status, user["id"], loan_id))
    return {"ok": True}


class ScanRequest(BaseModel):
    value: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2048)]
    event_id: int | None = Field(None, gt=0)


def scan_value(value):
    # Old battery QR labels contain a portal URL; Code 128/GS1-128 labels can
    # contain LF-B… directly or carry it as the GS1 serial (AI 21).
    if value.startswith(('https://','http://')):
        link=urlsplit(value)
        if (link.scheme,link.netloc,link.path.rstrip('/')) != (url.scheme,url.netloc,PREFIX):
            raise HTTPException(422,'Kód nepatrí tomuto klubu.')
        parameters=parse_qs(link.fragment)
        value=parameters.get('battery',[''])[0]

    value=value.strip()
    # ZXing may expose the Code 128 symbology identifier (]C1) and FNC1 as
    # ASCII Group Separator. Human-readable GS1 labels use parenthesized AIs.
    gs1=value[3:] if value.startswith(']C1') else value
    direct=re.search(r'LF-B[0-9]{2,6}(?![0-9])',gs1,re.IGNORECASE)
    if direct:
        value=direct.group(0).upper()
    elif gs1.startswith('('):
        # HRI form: (01)…(21)serial(91)… .
        fields=re.findall(r'\((\d{2,4})\)(.*?)(?=\(\d{2,4}\)|$)',gs1)
        serial=next((field.strip() for ai,field in fields if ai=='21'),None)
        if serial and re.fullmatch(r'[0-9]{2,6}',serial):
            value='LF-B'+serial
    else:
        # Raw GS1 element strings use FNC1 separators for variable-length
        # fields. Walk common fixed-length AIs so AI 21 can follow GTIN (01).
        parts=gs1.split('\x1d')
        serial=None
        for part in parts:
            if part.startswith('21'):
                serial=part[2:]
                break
        if serial is None and gs1.startswith('01') and len(gs1)>=16:
            rest=gs1[16:]
            if rest.startswith('21'):
                serial=rest[2:].split('\x1d',1)[0]
        if serial and re.fullmatch(r'[0-9]{2,6}',serial):
            value='LF-B'+serial

    if value.upper().startswith('LF-B'):
        value=value.upper()
        try:
            return 'battery',TypeAdapter(Code).validate_python(value)
        except ValueError:
            raise HTTPException(422,'Kód batérie musí mať LF-B a 2 až 6 číslic, napríklad LF-B01.') from None
    if value.upper().startswith('LF-C'):
        value=value.upper()
        try:
            controller=TypeAdapter(EquipmentCode).validate_python(value)
            return 'controller',controller
        except ValueError:
            raise HTTPException(422,'Kód ovládača musí mať LF-C a 2 až 6 číslic, napríklad LF-C01.') from None
    if value.upper().startswith('LF-D'):
        value=value.upper()
        try:
            drone=TypeAdapter(EquipmentCode).validate_python(value)
            return 'drone',drone
        except ValueError:
            raise HTTPException(422,'Kód dronu musí mať LF-D a 2 až 6 číslic, napríklad LF-D01.') from None
    if value.upper().startswith('LF-X'):
        value=value.upper()
        try:
            charger=TypeAdapter(ChargerCode).validate_python(value)
            return 'charger',charger
        except ValueError:
            raise HTTPException(422,'Kód nabíjačky musí mať LF-X a 2 až 6 číslic, napríklad LF-X01.') from None
    if re.fullmatch(r'LF-M:[A-Za-z0-9_-]{43}',value):
        return 'member',value[5:]
    raise HTTPException(422,'Nerozpoznaný kód. Použi kód zariadenia LF-B, LF-C, LF-D alebo LF-X, prípadne členský QR.')


@api.get('/scan/events')
def scan_events(conn:DB, _staff:User, day:CalendarDate | None = None):
    day=day or datetime.now(CLUB_ZONE).date()
    return conn.execute(
        """SELECT id,title,kind,starts_at,ends_at,
        starts_at<=now() AS can_record,
        (starts_at<=now() AND coalesce(ends_at,starts_at+interval '3 hours')>=now()) AS is_current
        FROM trainings WHERE NOT cancelled AND (starts_at AT TIME ZONE 'Europe/Bratislava')::date=%s
        ORDER BY starts_at,id""",(day,),
    ).fetchall()


class PrivateScanEvent(BaseModel):
    title: Short = "Neplánovaný tréning"
    starts_at: AwareDatetime
    ends_at: AwareDatetime | None = None
    location: Short = "Hala"


@api.post('/scan/private-events')
def create_private_scan_event(data:PrivateScanEvent,conn:DB,user:User):
    if data.starts_at > datetime.now(timezone.utc) or (data.ends_at and data.ends_at <= data.starts_at):
        raise HTTPException(422,"Súkromná udalosť musí práve prebiehať alebo už začať a koniec musí nasledovať po začiatku.")
    event=conn.execute(
        """INSERT INTO trainings(title,starts_at,ends_at,location,instructions,kind,created_by)
        VALUES (%s,%s,%s,%s,'', 'training',%s) RETURNING id,title,starts_at,ends_at,location""",
        (data.title,data.starts_at,data.ends_at,data.location,user['id']),
    ).fetchone()
    return event


@api.post('/scan')
def scan(data:ScanRequest, conn:DB, user:User):
    kind,code=scan_value(data.value)
    if kind in {"charger", "drone", "controller", "battery"}:
        require(user, "scanner.codes.equipment")
        require(user, "equipment.assets.read")
    if kind=='charger':
        batteries=conn.execute(
            """SELECT b.code,b.label,
            (SELECT CASE WHEN action='used' THEN 'in_drone' ELSE action END FROM battery_events
              WHERE code=b.code AND action IN ('used','charged','discharged','stored','storage_exit','damaged','retired')
              ORDER BY id DESC LIMIT 1) AS status
            FROM batteries b ORDER BY b.code"""
        ).fetchall()
        asset = conn.execute("""SELECT a.code,a.kind,a.label,l.status AS loan_status
            FROM equipment_assets a LEFT JOIN equipment_loans l ON l.code=a.code AND l.status IN ('pending','accepted')
            WHERE a.code=%s""", (code,)).fetchone()
        return {'type':'charger','code':code,'batteries':batteries,'asset':asset}
    if kind in {'controller','drone'}:
        asset=conn.execute(
            """SELECT a.code,a.kind,a.label,e.action AS status,e.created_at AS status_at,
              l.status AS loan_status
            FROM equipment_assets a LEFT JOIN LATERAL (
              SELECT action,created_at FROM equipment_events WHERE code=a.code
              AND action NOT IN ('note','assigned','returned') ORDER BY id DESC LIMIT 1
            ) e ON true LEFT JOIN equipment_loans l ON l.code=a.code AND l.status IN ('pending','accepted')
            WHERE a.code=%s""",(code,),
        ).fetchone()
        if not asset and not access.allows(user, "equipment.assets.create"):
            raise HTTPException(404,'Zariadenie nie je evidované. Požiadaj trénera o jeho pridanie.')
        return {'type':'equipment','exists':bool(asset),'code':code,
                'kind':asset['kind'] if asset else kind,'label':asset['label'] if asset else code,
                'status':asset['status'] if asset else None,'status_at':asset['status_at'] if asset else None,
                'loan_status':asset['loan_status'] if asset else None}
    if kind=='battery':
        battery=conn.execute(
            """SELECT b.*,(SELECT CASE WHEN action='used' THEN 'in_drone' ELSE action END FROM battery_events WHERE code=b.code
              AND action IN ('used','charged','discharged','stored','storage_exit','damaged','retired')
              ORDER BY id DESC LIMIT 1) AS status,
              (SELECT created_at FROM battery_events WHERE code=b.code
              AND action IN ('used','charged','discharged','stored','storage_exit','damaged','retired')
              ORDER BY id DESC LIMIT 1) AS status_at
            FROM batteries b WHERE b.code=%s""",(code,),
        ).fetchone()
        if not battery:
            if not access.allows(user, "equipment.assets.create"):
                raise HTTPException(404,'Batéria nie je evidovaná. Požiadaj trénera o jej pridanie.')
            return {'type':'battery','exists':False,'code':code}
        return {'type':'battery','exists':True,**battery}
    require(user, "scanner.codes.member")
    # Match the same locking order as attendance edits and event deletion.
    if data.event_id is not None:
        if user.get('preview'):
            raise HTTPException(403, "V náhľade roly sa údaje nemenia.")
        event=lock_training(conn,data.event_id)
        require(user, "attendance.records.scan")
        if event['cancelled'] or event['starts_at']>datetime.now(timezone.utc) or (event['ends_at'] and event['ends_at']<datetime.now(timezone.utc)):
            raise HTTPException(409,'Dochádzku možno zapísať iba počas prebiehajúcej alebo začatej nezrušenej udalosti.')
    person=conn.execute(
        "SELECT id,name FROM members WHERE card_token=%s AND role IN ('member','coach') AND active FOR UPDATE",(code,),
    ).fetchone()
    if not person or not card_eligible(conn, person["id"]):
        raise HTTPException(404,'Členský QR už neplatí alebo člen nie je aktívny.')
    if data.event_id is None:
        return {'type':'member',**person,'recorded':False}
    previous=conn.execute('SELECT attended FROM participation WHERE training_id=%s AND member_id=%s',
                          (data.event_id,person['id'])).fetchone()
    conn.execute(
        """INSERT INTO participation(training_id,member_id,attended) VALUES (%s,%s,true)
        ON CONFLICT(training_id,member_id) DO UPDATE SET attended=true""",(data.event_id,person['id']),
    )
    return {'type':'member',**person,'recorded':True,'already_present':bool(previous and previous['attended']),
            'event_id':event['id'],'event_title':event['title']}


class BatteryChargeBatch(BaseModel):
    charger_code: ChargerCode
    request_id: UUID
    codes: Annotated[list[Code], Field(min_length=1, max_length=50)]


@api.post('/battery-charges')
def charge_batteries(data:BatteryChargeBatch,conn:DB,user:User):
    codes=sorted(set(data.codes))
    if len(codes)!=len(data.codes):
        raise HTTPException(422,'Batéria môže byť vo výbere uvedená iba raz.')
    previous=conn.execute("SELECT charger_code,actor_id,battery_codes FROM battery_charge_runs WHERE request_id=%s FOR UPDATE",
                          (data.request_id,)).fetchone()
    if previous:
        if previous['charger_code']!=data.charger_code or previous['actor_id']!=user['id'] or sorted(previous['battery_codes'])!=codes:
            raise HTTPException(409,'Identifikátor nabíjania už bol použitý.')
        return {'ok':True,'count':len(codes),'duplicate':True}
    found=conn.execute("SELECT code FROM batteries WHERE code=ANY(%s) ORDER BY code FOR UPDATE",(codes,)).fetchall()
    if len(found)!=len(codes):
        raise HTTPException(404,'Jedna alebo viaceré vybrané batérie sa nenašli.')
    states=conn.execute(
        """SELECT DISTINCT ON (code) code,action FROM battery_events
        WHERE code=ANY(%s) AND action IN ('used','charged','discharged','stored','storage_exit','damaged','retired')
        ORDER BY code,id DESC""",(codes,),
    ).fetchall()
    blocked=[row['code'] for row in states if row['action'] in {'damaged','retired','stored'}]
    if blocked:
        raise HTTPException(409,'Poškodené, vyradené alebo uskladnené batérie nemožno označiť ako nabité: '+', '.join(blocked))
    conn.execute("INSERT INTO battery_charge_runs(request_id,charger_code,actor_id,battery_codes) VALUES (%s,%s,%s,%s)",
                 (data.request_id,data.charger_code,user['id'],codes))
    with conn.cursor() as cursor:
        cursor.executemany("INSERT INTO battery_events(code,actor_id,action,note) VALUES (%s,%s,'charged',%s)",
                           [(code,user['id'],f"Multinabíjačka {data.charger_code}") for code in codes])
    return {'ok':True,'count':len(codes)}


def card_eligible(conn, member_id):
    member = conn.execute("SELECT role,club_roles FROM members WHERE id=%s AND active", (member_id,)).fetchone()
    return member and (member["role"] == "superadmin" or
                       "profile.card.own" in access.effective(conn, member["club_roles"] or []))


def digital_card(conn,member_id):
    if not card_eligible(conn, member_id):
        raise HTTPException(404, "Členský QR nie je dostupný.")
    card=conn.execute(
        """UPDATE members SET card_token=COALESCE(card_token,%s)
        WHERE id=%s AND active RETURNING id,name,card_token""",
        (secrets.token_urlsafe(32),member_id),
    ).fetchone()
    if not card:
        raise HTTPException(404,'QR kód je dostupný iba aktívnemu členovi.')
    return {'id':card['id'],'name':card['name'],'payload':'LF-M:'+card['card_token']}


def rounded_member_qr(payload):
    qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=10,border=4)
    qr.add_data(payload)
    qr.make(fit=True)
    size=len(qr.modules)
    dimension=(size+8)*10
    svg=ET.Element('svg',xmlns='http://www.w3.org/2000/svg',viewBox=f'0 0 {dimension} {dimension}',
                   width=str(dimension),height=str(dimension))
    ET.SubElement(svg,'rect',width='100%',height='100%',fill='white')
    eyes=[(0,0),(size-7,0),(0,size-7)]
    modules=ET.SubElement(svg,'g',fill='#10354B')
    snake=ET.SubElement(svg,'g',fill='none',stroke='#10354B',
                        **{'stroke-width':'9.4','stroke-linecap':'round'})
    for row,line in enumerate(qr.modules):
        for col,dark in enumerate(line):
            if not dark or any(x<=col<x+7 and y<=row<y+7 for x,y in eyes):
                continue
            cx,cy=(col+4)*10+5,(row+4)*10+5
            ET.SubElement(modules,'circle',cx=str(cx),cy=str(cy),r='4.65')
            # Join neighboring cells into rounded, continuous paths instead of
            # rendering the data pattern as a field of separate dots.
            for dx,dy in ((1,0),(0,1)):
                nx,ny=col+dx,row+dy
                if nx<size and ny<size and qr.modules[ny][nx] and not any(x<=nx<x+7 and y<=ny<y+7 for x,y in eyes):
                    ET.SubElement(snake,'path',d=f'M {cx} {cy} L {cx+dx*10} {cy+dy*10}')
    # Rounded finder rings preserve the recognizable center lines used by decoders.
    for x,y in eyes:
        for inset,span,radius,fill in [(0,7,13,'#10354B'),(1,5,8,'white'),(2,3,6,'#10354B')]:
            ET.SubElement(svg,'rect',x=str((x+4+inset)*10),y=str((y+4+inset)*10),
                          width=str(span*10),height=str(span*10),rx=str(radius),fill=fill)
    return ET.tostring(svg)


def card_qr(conn,member_id):
    card=digital_card(conn,member_id)
    return Response(rounded_member_qr(card['payload']),media_type='image/svg+xml')


@api.get('/me/card')
def my_card(conn:DB,user:User):
    return digital_card(conn,user['id'])


@api.get('/me/card.svg')
def my_card_qr(conn:DB,user:User):
    return card_qr(conn,user['id'])


@api.get('/members/{member_id}/card')
def member_card(member_id:int,conn:DB,_staff:User):
    return digital_card(conn,member_id)


@api.get('/members/{member_id}/card.svg')
def member_card_qr(member_id:int,conn:DB,_staff:User):
    return card_qr(conn,member_id)


@api.post('/members/{member_id}/card/reset')
def reset_member_card(member_id:int,conn:DB,_staff:User):
    if not conn.execute("UPDATE members SET card_token=%s WHERE id=%s AND role IN ('member','coach') AND active",
                        (secrets.token_urlsafe(32),member_id)).rowcount:
        raise HTTPException(404,'Aktívny člen sa nenašiel.')
    return digital_card(conn,member_id)


class PushPreferences(BaseModel):
    push_messages: bool
    push_calendar: bool
    push_announcements: bool


@api.put('/me/notification-preferences')
def notification_preferences(data:PushPreferences, conn:DB, user:User):
    conn.execute('UPDATE members SET push_messages=%s,push_calendar=%s,push_announcements=%s WHERE id=%s',
                 (data.push_messages,data.push_calendar,data.push_announcements,user['id']))
    return data.model_dump()


@api.get('/push/config')
def push_config(conn:DB, _user:User):
    return {'public_key':conn.execute('SELECT public_key FROM push_keys WHERE id=1').fetchone()['public_key']}


class PushKeys(BaseModel):
    p256dh: Annotated[str,Field(max_length=100)]
    auth: Annotated[str,Field(max_length=30)]


class PushSubscription(BaseModel):
    endpoint: Annotated[str,Field(max_length=2048)]
    keys: PushKeys

    @model_validator(mode='after')
    def validate_subscription(self):
        endpoint=urlsplit(self.endpoint)
        host=endpoint.hostname or ''
        allowed=(host=='fcm.googleapis.com' or host=='updates.push.services.mozilla.com'
                 or host.endswith('.push.services.mozilla.com') or host=='web.push.apple.com'
                 or host.endswith('.push.apple.com') or host.endswith('.notify.windows.com'))
        if endpoint.scheme!='https' or not allowed or endpoint.port not in (None,443) or endpoint.username or endpoint.password or endpoint.fragment:
            raise ValueError('Nepodporovaná push služba.')
        try:
            public=base64.urlsafe_b64decode(self.keys.p256dh+'='*(-len(self.keys.p256dh)%4))
            auth=base64.urlsafe_b64decode(self.keys.auth+'='*(-len(self.keys.auth)%4))
            from cryptography.hazmat.primitives.asymmetric import ec
            ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
            if len(auth)!=16:
                raise ValueError('Invalid authentication secret')
        except (ValueError,binascii.Error):
            raise ValueError('Neplatné push kľúče.') from None
        return self


@api.post('/push/subscriptions')
def subscribe_push(data:PushSubscription, conn:DB, user:User):
    if user['role']=='superadmin':
        raise HTTPException(403,'Systémový účet neprijíma klubové upozornenia.')
    conn.execute('DELETE FROM push_subscriptions WHERE endpoint=%s AND member_id<>%s', (data.endpoint,user['id']))
    conn.execute('''INSERT INTO push_subscriptions(member_id,endpoint,p256dh,auth) VALUES (%s,%s,%s,%s)
                 ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth''',
                 (user['id'],data.endpoint,data.keys.p256dh,data.keys.auth))
    return {'ok':True}


class PushEndpoint(BaseModel):
    endpoint: Annotated[str,Field(max_length=2048)]


@api.delete('/push/subscriptions')
def unsubscribe_push(data:PushEndpoint, conn:DB, user:User):
    conn.execute('DELETE FROM push_subscriptions WHERE endpoint=%s AND member_id=%s',(data.endpoint,user['id']))
    return {'ok':True}


@api.get('/push/notifications/{notification_id}')
def push_notification(notification_id:int, conn:DB, user:User):
    item=conn.execute('SELECT * FROM push_notifications WHERE id=%s AND member_id=%s AND created_at>now()-interval \'1 day\'',
                      (notification_id,user['id'])).fetchone()
    if not item or not user['push_'+item['channel']]:
        raise HTTPException(404,'Upozornenie už nie je dostupné.')
    require(user, {"calendar": "calendar.events.read", "messages": "messages.chat.read",
                   "announcements": "announcements.notices.read"}[item["channel"]])
    if item['announcement_id'] is not None:
        notice=notice_access(conn,item['announcement_id'],user)
        if notice['audience']=='selected' and not conn.execute(
            'SELECT 1 FROM announcement_recipients WHERE announcement_id=%s AND member_id=%s',
            (notice['id'],user['id'])).fetchone():
            raise HTTPException(404,'Upozornenie už nie je dostupné.')
    if item['message_id'] is not None:
        msg=conn.execute('SELECT * FROM messages WHERE id=%s',(item['message_id'],)).fetchone()
        if not msg:
            raise HTTPException(404,'Správa sa nenašla.')
        if msg['group_id'] is not None:
            accessible_group(conn,msg['group_id'],user)
        elif user['id'] not in (msg['sender_id'],msg['recipient_id']):
            raise HTTPException(404,'Správa sa nenašla.')
    return {'title':item['title'],'path':item['path'],'channel':item['channel']}


app.include_router(api)
if PREFIX:
    @app.get(PREFIX, include_in_schema=False)
    def portal_redirect():
        return RedirectResponse(f"{PUBLIC_URL}/", status_code=308)

app.mount(PREFIX or "/", StaticFiles(directory=os.environ.get("HUB_DIST", ROOT / "dist"), html=True), name="portal")
