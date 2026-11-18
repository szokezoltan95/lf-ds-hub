import base64
import binascii
import hashlib
from threading import Event, Thread
import push_service

import hmac
import os
import re
import secrets
from xml.etree import ElementTree as ET
from contextlib import asynccontextmanager
from datetime import date as CalendarDate, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb
import qrcode
import qrcode.image.svg
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
STAFF_ROLES = ("superadmin", "coach")
MENU_KEYS = ("home", "calendar", "attendance", "scanner", "messages", "announcements", "members",
             "team", "development", "lineups", "drills", "equipment", "documents")
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
                                ("home", "calendar", "attendance", "members", "team", "lineups", "announcements", "documents")),
    "recruitment_coordinator": ("Koordinátor náboru", "Komunikuje so záujemcami a organizuje nábor.", False, False, ()),
    "safety_coordinator": ("Bezpečnostný a prevádzkový koordinátor", "Spravuje bezpečnostné postupy a poučenia.", False, False, ()),
    "team_coordinator": ("Koordinátor tímov", "Koordinuje zloženie tímov a priradenie hráčov.", True, True,
                         ("home", "calendar", "members", "team", "lineups")),
    "content_creator": ("Fotograf / tvorca obsahu", "Pripravuje fotografie a klubový obsah.", False, False, ()),
}
ROLE_CAPABILITIES = {
    "player": [("Klubový kalendár a potvrdenie účasti", True), ("Správy, oznamy a dokumenty", True),
               ("Osobný členský QR kód", True), ("Záznam použitia batérií", True)],
    "coach": [("Plánovanie a správa udalostí", True), ("Dochádzka a skenovanie členských QR kódov", True),
              ("Tímové zostavy a rozvoj hráčov", True), ("Plány tréningov a knižnica cvičení", True),
              ("Oznamy, vybavenie a dokumenty", True)],
    "club_leader": [("Klubová administrácia a evidencia členov", True), ("Kalendár, dochádzka a zostavy", True),
                    ("Oznamy, vybavenie a dokumenty", True), ("Schvaľovanie žiadostí o roly", False)],
    "deputy_leader": [("Zastupovanie pri klubovej administrácii", True), ("Kalendár, dochádzka a zostavy", True),
                      ("Oznamy, vybavenie a dokumenty", True), ("Schvaľovanie žiadostí o roly", False)],
    "administrator": [("Pozývanie členov a základná správa členskej evidencie", True),
                      ("Oznamy a klubové dokumenty", True), ("Správa rolí", False)],
    "equipment_technician": [("Evidencia batérií a techniky", True), ("Záznamy používania a skenovanie", True),
                             ("Servisné záznamy a hlásenie porúch", False)],
    "social_media_manager": [("Oznamy v aplikácii", True), ("Správa sociálnych sietí", False),
                             ("Nahrávanie mediálnych galérií", False)],
    "competition_coordinator": [("Kalendár zápasov a súťaží", True), ("Dochádzka a nominácie", True),
                                ("Zostavy na zápasy", True), ("Registrácia na turnaje", False)],
    "recruitment_coordinator": [("Evidencia záujemcov a náborové formuláre", False),
                                ("Pozvánky a náborová komunikácia", False)],
    "safety_coordinator": [("Bezpečnostné pokyny a poučenia", False), ("Evidencia školení a incidentov", False)],
    "team_coordinator": [("Zobrazenie tímov a klubových zostáv", True), ("Samostatná správa súpisiek tímov", False)],
    "content_creator": [("Nahrávanie klubových fotografií a videí", False),
                        ("Mediálna galéria a evidencia súhlasov", False)],
}


def seed_access_control(conn):
    for key, (name, description, available, admin_access, pages) in ROLE_DEFINITIONS.items():
        conn.execute("""INSERT INTO role_catalog(role_key,name,description,available,admin_access)
            VALUES (%s,%s,%s,%s,%s) ON CONFLICT(role_key) DO UPDATE SET
            name=excluded.name,description=excluded.description,available=excluded.available,
            admin_access=excluded.admin_access""", (key, name, description, available, admin_access))
        conn.executemany("""INSERT INTO role_menu_permissions(role_key,menu_key,enabled)
            VALUES (%s,%s,%s) ON CONFLICT(role_key,menu_key) DO NOTHING""",
            [(key, page, page in pages) for page in MENU_KEYS])


def menu_for_path(path):
    path = path.split("/api/", 1)[-1]
    if path.startswith(("trainings", "places")):
        return "attendance" if "/attendance" in path else "lineups" if "/lineup" in path else "calendar"
    if path.startswith(("attendance",)):
        return "attendance"
    if path.startswith(("scan",)):
        return "scanner"
    if path.startswith(("members",)):
        return "development" if "/development" in path else "members"
    if path.startswith("role-requests"):
        return "members"
    if path.startswith(("lineup",)):
        return "lineups"
    if path.startswith(("drills",)):
        return "drills"
    if path.startswith(("announcements", "announcement-")):
        return "announcements"
    if path.startswith(("documents",)):
        return "documents"
    if path.startswith(("conversations", "contacts", "chat-groups", "messages")):
        return "messages"
    if path.startswith(("batteries",)):
        return "equipment"
    return None


def sync_account_roles(conn, member_id, roles):
    roles = sorted(set(roles) | {"player"})
    account_role = "coach" if any(ROLE_DEFINITIONS[key][3] for key in roles) else "member"
    conn.execute("UPDATE members SET club_roles=%s,role=%s WHERE id=%s",
                 (roles, account_role, member_id))


def effective_menu(conn, user):
    if user["role"] == "superadmin":
        return list(MENU_KEYS)
    roles = user.get("club_roles") or ["player"]
    rows = conn.execute("""SELECT DISTINCT menu_key FROM role_menu_permissions
        WHERE role_key=ANY(%s) AND enabled""", (roles,)).fetchall()
    return sorted({row["menu_key"] for row in rows} | {"home"})
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254,
                                        pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Code = Annotated[str, StringConstraints(pattern=r"^LF-B[0-9]{2,6}$")]


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


@asynccontextmanager
async def lifespan(_app):
    try:
        password = TypeAdapter(Password).validate_python(os.environ.get("HUB_ADMIN_PASSWORD", ""))
    except ValueError:
        raise RuntimeError("Set HUB_ADMIN_PASSWORD to a password of 8–128 characters") from None

    with connect() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(81364, 1)")
        conn.execute((ROOT / "schema.sql").read_text(), prepare=False)
        seed_access_control(conn)
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
                    "INSERT INTO members (name, role, password_hash) VALUES (%s, 'superadmin', %s)",
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
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    return JSONResponse({"detail": "Skontroluj vyplnené údaje."}, status_code=422)


def identity(request: Request, conn: DB):
    token = request.cookies.get(COOKIE, "")
    member = conn.execute(
        """SELECT m.id, m.name, m.email, m.role, m.club_roles, m.pwa_show_card, m.pwa_show_popup, m.push_messages, m.push_calendar, m.push_announcements FROM sessions s
        JOIN members m ON m.id = s.member_id
        WHERE s.token_hash = %s AND s.expires_at > now() AND m.active""", (digest(token),)
    ).fetchone()
    if not member:
        raise HTTPException(401, "Prihlás sa do portálu.")
    member["roles"] = member.get("club_roles") or ([] if member["role"] == "superadmin" else ["player"])
    member["menu_access"] = effective_menu(conn, member)
    menu_key = menu_for_path(request.url.path)
    if menu_key and member["role"] != "superadmin" and menu_key not in member["menu_access"]:
        raise HTTPException(403, "K tejto časti aplikácie nemáš prístup.")
    return member


User = Annotated[dict, Depends(identity, scope="function")]


def staff(user: User):
    if user["role"] not in STAFF_ROLES:
        raise HTTPException(403, "Tento úkon vyžaduje oprávnenie trénera.")
    return user


Staff = Annotated[dict, Depends(staff, scope="function")]


def superadmin(user: User):
    if user["role"] != "superadmin":
        raise HTTPException(403, "Tento úkon môže vykonať iba superadmin.")
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


class AccountRole(BaseModel):
    role: Literal["coach", "member"]


class Active(BaseModel):
    active: bool


class RoleRequests(BaseModel):
    roles: list[str] = Field(min_length=1, max_length=12)


class RoleDecision(BaseModel):
    status: Literal["approved", "rejected"]


class RoleMenuConfig(BaseModel):
    permissions: dict[str, bool]


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
    rows = conn.execute("""SELECT c.role_key,c.name,c.description,c.available,c.admin_access,
        p.menu_key,p.enabled FROM role_catalog c JOIN role_menu_permissions p USING(role_key)
        ORDER BY c.role_key,p.menu_key""").fetchall()
    result = {}
    for row in rows:
        item = result.setdefault(row["role_key"], {"key":row["role_key"],"name":row["name"],
            "description":row["description"],"available":row["available"],"admin_access":row["admin_access"],"permissions":{}})
        item["permissions"][row["menu_key"]] = row["enabled"]
    for key, item in result.items():
        item["capabilities"] = [{"name":name,"available":available} for name,available in ROLE_CAPABILITIES[key]]
    return {"roles":list(result.values()),"menus":list(MENU_KEYS)}


@api.get("/role-catalog")
def get_role_catalog(conn: DB, user: User):
    if user["role"] == "superadmin":
        raise HTTPException(403, "Systémový účet sa nezúčastňuje na klubových rolách.")
    rows=conn.execute("SELECT role_key AS key,name,description,available FROM role_catalog ORDER BY name").fetchall()
    for row in rows:
        row["capabilities"]=[{"name":name,"available":available} for name,available in ROLE_CAPABILITIES[row["key"]]]
    return rows


@api.put("/role-config/{role_key}")
def update_role_config(role_key: str, data: RoleMenuConfig, conn: DB, _admin: Superadmin):
    if role_key not in ROLE_DEFINITIONS or set(data.permissions) != set(MENU_KEYS):
        raise HTTPException(422, "Nastavenie obsahuje neznámu rolu alebo položku menu.")
    conn.executemany("""INSERT INTO role_menu_permissions(role_key,menu_key,enabled)
        VALUES (%s,%s,%s) ON CONFLICT(role_key,menu_key) DO UPDATE SET enabled=excluded.enabled""",
        [(role_key, key, value) for key, value in data.permissions.items()])
    return {"ok":True}


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
def role_requests(conn: DB, user: Staff):
    if user["role"] != "superadmin" and "club_leader" not in user["roles"] and "deputy_leader" not in user["roles"]:
        raise HTTPException(403, "Žiadosti o roly môže prezerať iba vedenie klubu.")
    return conn.execute("""SELECT r.id,r.member_id,m.name AS member_name,m.email,r.role_key,c.name AS role_name,
        r.created_at,r.status FROM role_requests r JOIN members m ON m.id=r.member_id
        JOIN role_catalog c USING(role_key) WHERE r.status='pending' ORDER BY r.created_at,r.id""").fetchall()


@api.put("/role-requests/{request_id}")
def decide_role_request(request_id: int, data: RoleDecision, conn: DB, _admin: Superadmin):
    request = conn.execute("""SELECT member_id,role_key FROM role_requests
        WHERE id=%s AND status='pending' FOR UPDATE""", (request_id,)).fetchone()
    if not request:
        raise HTTPException(404, "Čakajúca žiadosť sa nenašla.")
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
    return user


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


class Profile(BaseModel):
    name: Short


class ChangePassword(BaseModel):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    password: Password


@api.put("/me")
def update_profile(data: Profile, conn: DB, user: User):
    conn.execute("UPDATE members SET name=%s WHERE id=%s", (data.name, user["id"]))
    return {"ok": True}


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
        JOIN trainings t ON t.id=p.training_id WHERE p.member_id=%s
        AND p.attended IS NOT NULL ORDER BY t.starts_at DESC""", (user["id"],),
    ).fetchall()


@api.get("/members")
def members(conn: DB, _user: User):
    return conn.execute(
        """SELECT m.id, m.email, m.name, m.role, m.club_roles AS roles, m.active,
        m.password_hash IS NOT NULL AS registered,
        (SELECT count(*) FROM participation WHERE member_id=m.id AND attended=true) AS attended_count,
        (SELECT count(*) FROM participation WHERE member_id=m.id AND attended IS NOT NULL) AS recorded_count
        FROM members m WHERE role IN ('member', 'coach') ORDER BY name, id"""
    ).fetchall()


class MemberRoles(BaseModel):
    roles: list[str] = Field(min_length=1, max_length=12)


@api.put("/members/{member_id}/roles")
def update_member_roles(member_id: int, data: MemberRoles, conn: DB, _admin: Superadmin):
    roles = set(data.roles)
    if not roles <= set(ROLE_DEFINITIONS):
        raise HTTPException(422, "Zoznam obsahuje neznámu rolu.")
    current = conn.execute("SELECT role FROM members WHERE id=%s AND role IN ('member','coach') FOR UPDATE",
                           (member_id,)).fetchone()
    if not current:
        raise HTTPException(404, "Člena sa nenašlo.")
    sync_account_roles(conn, member_id, roles)
    return {"roles":sorted(roles or {"player"})}


@api.post("/members/invite")
def invite(data: Invite, conn: DB, user: Staff):
    if user["role"] != "superadmin" and data.roles != ["player"]:
        raise HTTPException(403, "Iba superadmin môže priradiť roly pri pozvánke.")
    roles = sorted(set(data.roles) | {"player"})
    if not set(roles) <= set(ROLE_DEFINITIONS):
        raise HTTPException(422, "Pozvánka obsahuje neznámu rolu.")
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
                              user["role"] == "superadmin", user["role"] == "superadmin")
    ).fetchone()
    if not member:
        raise HTTPException(409, "Tento e-mail už patrí existujúcemu účtu.")
    return {"invite_url": f"{PUBLIC_URL}/#invite={token}"}


@api.post("/members/coaches")
def create_coach(data: CoachAccount, conn: DB, _admin: Superadmin):
    member = conn.execute(
        """INSERT INTO members (email, name, role, club_roles, password_hash)
        VALUES (%s, %s, 'coach', ARRAY['player','coach']::text[], %s) ON CONFLICT (email) DO NOTHING RETURNING id""",
        (data.email, data.name, password_hash(data.password)),
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
            WHERE id=%s""", (data.role, ["player","coach"] if data.role == "coach" else ["player"], member_id),
        )
    return {"ok": True}


@api.delete("/members/{member_id}")
def delete_member(member_id: int, conn: DB, _admin: Superadmin):
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


@api.post("/members/{member_id}/reset")
def reset_member_password(member_id: int, conn: DB, user: Staff):
    token = secrets.token_urlsafe(32)
    member = conn.execute(
        """UPDATE members SET invite_hash=%s, invite_until=now() + interval '7 days'
        WHERE id=%s AND active AND (role='member' OR (role='coach' AND %s))
        AND password_hash IS NOT NULL RETURNING id""",
        (digest(token), member_id, user["role"] == "superadmin"),
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
def set_active(member_id: int, data: Active, conn: DB, user: Staff):
    member = conn.execute(
        """UPDATE members SET active=%s WHERE id=%s
        AND (role='member' OR (role='coach' AND %s)) RETURNING id""",
        (data.active, member_id, user["role"] == "superadmin"),
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


class RSVP(BaseModel):
    response: Literal["yes", "no", "maybe"]
    note: Note = ""


class Attendance(BaseModel):
    attended: bool


@api.get("/trainings")
def trainings(conn: DB, user: User):
    return conn.execute(
        """SELECT t.*, p.response, p.note, p.attended,
        (%s OR t.created_by=%s OR t.created_by IS NULL) AS can_delete,
        (SELECT json_build_object(
            'yes', count(*) FILTER (WHERE r.response='yes'),
            'no', count(*) FILTER (WHERE r.response='no'),
            'maybe', count(*) FILTER (WHERE r.response='maybe'),
            'unanswered', count(*) FILTER (WHERE r.response IS NULL),
            'attendance_pending', count(*) FILTER (WHERE r.attended IS NULL))
         FROM members m LEFT JOIN participation r ON r.member_id=m.id AND r.training_id=t.id
         WHERE 'player'=ANY(m.club_roles) AND m.active AND m.password_hash IS NOT NULL) AS counts
        FROM trainings t
        LEFT JOIN participation p ON p.training_id = t.id AND p.member_id = %s
        ORDER BY (t.starts_at >= now()) DESC,
        CASE WHEN t.starts_at >= now() THEN t.starts_at END,
        t.starts_at DESC LIMIT 300""", (user["role"] == "superadmin", user["id"], user["id"]),
    ).fetchall()


@api.post("/trainings")
def create_training(data: Training, conn: DB, user: Staff):
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
        push_service.enqueue(conn, None, "calendar", "Nová udalosť: " + data.title,
                             f"#page=calendar&event={event['id']}", event_id=event['id'], exclude=user['id'])
    return {"ok": True}


def lock_training(conn, training_id):
    training = conn.execute("SELECT * FROM trainings WHERE id = %s FOR UPDATE",
                            (training_id,)).fetchone()
    if not training:
        raise HTTPException(404, "Udalosť sa nenašla.")
    return training


@api.put("/trainings/{training_id}")
def edit_training(training_id: int, data: TrainingEdit, conn: DB, _staff: Staff):
    training = lock_training(conn, training_id)
    if training["cancelled"]:
        raise HTTPException(409, "Udalosť bola zrušená.")
    conn.execute(
        """UPDATE trainings SET title=%s, starts_at=%s, location=%s, instructions=%s,
        kind=%s, ends_at=%s, updated_at=now() WHERE id=%s""",
        (data.title, data.starts_at, data.location, data.instructions, data.kind, data.ends_at, training_id)
    )
    schedule_changed = training["starts_at"] != data.starts_at or training["location"] != data.location
    if any(training[field] != getattr(data, field) for field in
           ("title", "starts_at", "location", "instructions", "kind", "ends_at")):
        if schedule_changed and training["starts_at"] > datetime.now(timezone.utc):
            conn.execute("UPDATE participation SET response=NULL, note='' WHERE training_id=%s",
                         (training_id,))
        conn.execute(
            "INSERT INTO announcements (title, body, event_id) VALUES (%s,%s,%s) RETURNING id",
            (f"Zmena udalosti: {data.title}",
             f"Nový termín: {club_date(data.starts_at)} · {data.location}", training_id),
        )
        push_service.enqueue(conn, None, "calendar", "Zmena udalosti: " + data.title,
                             f"#page=calendar&event={training_id}", event_id=training_id)
    return {"ok": True}


@api.post("/trainings/{training_id}/cancel")
def cancel_training(training_id: int, conn: DB, _staff: Staff):
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
def delete_training(training_id: int, conn: DB, user: Staff):
    training = lock_training(conn, training_id)
    if user["role"] != "superadmin" and training["created_by"] not in (None, user["id"]):
        raise HTTPException(403, "Vymazať môžeš iba vlastnú udalosť.")
    conn.execute("DELETE FROM trainings WHERE id=%s", (training_id,))
    return {"ok": True}


def club_date(timestamp):
    return timestamp.astimezone(CLUB_ZONE).strftime("%d.%m.%Y %H:%M")


@api.put("/trainings/{training_id}/rsvp")
def rsvp(training_id: int, data: RSVP, conn: DB, user: User):
    if "player" not in user["roles"]:
        raise HTTPException(403, "Účasť potvrdzujú členovia.")
    training = lock_training(conn, training_id)
    if training["cancelled"] or training["starts_at"] <= datetime.now(timezone.utc):
        raise HTTPException(409, "Na túto udalosť sa už nedá prihlásiť.")
    conn.execute(
        """INSERT INTO participation (training_id, member_id, response, note) VALUES (%s,%s,%s,%s)
        ON CONFLICT (training_id, member_id) DO UPDATE SET response=excluded.response, note=excluded.note""",
        (training_id, user["id"], data.response, data.note),
    )
    return {"ok": True}


@api.get("/trainings/{training_id}/roster")
def roster(training_id: int, conn: DB, _staff: Staff):
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Udalosť sa nenašla.")
    return conn.execute(
        """SELECT m.id, m.name, p.response, p.note, p.attended FROM members m
        LEFT JOIN participation p ON p.member_id=m.id AND p.training_id=%s
        WHERE ('player'=ANY(m.club_roles) AND m.active AND m.password_hash IS NOT NULL) OR p.member_id IS NOT NULL
        ORDER BY m.name, m.id""",
        (training_id,)
    ).fetchall()


@api.put("/trainings/{training_id}/attendance/{member_id}")
def attendance(training_id: int, member_id: int, data: Attendance, conn: DB, _staff: Staff):
    training = lock_training(conn, training_id)
    if training["cancelled"] or training["starts_at"] > datetime.now(timezone.utc):
        raise HTTPException(409, "Dochádzku možno zapísať od začiatku udalosti.")
    if not conn.execute(
        "SELECT 1 FROM members WHERE id=%s AND ('player'=ANY(club_roles) OR EXISTS (SELECT 1 FROM participation WHERE member_id=%s AND training_id=%s))",
        (member_id, member_id, training_id),
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
def bulk_attendance(training_id: int, data: BulkAttendance, conn: DB, _staff: Staff):
    training = lock_training(conn, training_id)
    if training["cancelled"] or training["starts_at"] > datetime.now(timezone.utc):
        raise HTTPException(409, "Dochádzku možno zapísať od začiatku udalosti.")
    ids = set(data.member_ids)
    allowed = conn.execute(
        """SELECT id FROM members WHERE id=ANY(%s) AND
        ('player'=ANY(club_roles) OR EXISTS (SELECT 1 FROM participation WHERE member_id=members.id AND training_id=%s))""",
        (list(ids), training_id),
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
def attendance_matrix(conn: DB, _staff: Staff, date_from: CalendarDate | None = None,
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
        "SELECT id,name,active FROM members WHERE 'player'=ANY(club_roles) ORDER BY lower(name),id"
    ).fetchall()
    attendance = conn.execute(
        """SELECT p.training_id,p.member_id,p.attended FROM participation p
        JOIN members m ON m.id=p.member_id WHERE 'player'=ANY(m.club_roles)
        AND p.training_id=ANY(%s) AND p.attended IS NOT NULL""",
        ([event["id"] for event in events],),
    ).fetchall()
    return {"events": events, "members": members, "attendance": attendance}


@api.get("/members/{member_id}/attendance")
def member_attendance(member_id: int, conn: DB, _staff: Staff):
    return conn.execute(
        """SELECT t.title, t.starts_at, p.attended FROM participation p
        JOIN trainings t ON t.id=p.training_id
        WHERE p.member_id=%s AND p.attended IS NOT NULL ORDER BY t.starts_at DESC""",
        (member_id,)
    ).fetchall()


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
        "SELECT id FROM members WHERE id=ANY(%s) AND 'player'=ANY(club_roles) AND active AND password_hash IS NOT NULL", (list(seen),)
    ).fetchall()} if seen else set()
    if seen != valid_ids:
        raise HTTPException(422, "Zostava obsahuje neaktívneho alebo neplatného člena.")
    return players


@api.get("/lineup/general")
def get_general_lineup(conn: DB, _user: User):
    saved = conn.execute("SELECT players FROM club_lineup WHERE id=1").fetchone()
    roster = conn.execute(
        """SELECT id,name FROM members WHERE 'player'=ANY(club_roles) AND active AND password_hash IS NOT NULL
        ORDER BY lower(name),id"""
    ).fetchall()
    return {"players": saved["players"] if saved else [], "source": "general", "roster": roster}


@api.put("/lineup/general")
def save_general_lineup(data: TrainingLineupInput, conn: DB, user: Staff):
    players = clean_lineup(conn, data.players)
    conn.execute(
        """INSERT INTO club_lineup(id,players,updated_by) VALUES (1,%s,%s)
        ON CONFLICT(id) DO UPDATE SET players=excluded.players,updated_by=excluded.updated_by,updated_at=now()""",
        (Jsonb(players), user["id"]),
    )
    return {"ok": True}


@api.get("/trainings/{training_id}/lineup")
def get_training_lineup(training_id: int, conn: DB, _user: User):
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Udalosť sa nenašla.")
    saved = conn.execute("SELECT players FROM training_lineups WHERE training_id=%s", (training_id,)).fetchone()
    general = conn.execute("SELECT players FROM club_lineup WHERE id=1").fetchone()
    roster = conn.execute(
        """SELECT id,name FROM members WHERE 'player'=ANY(club_roles) AND active AND password_hash IS NOT NULL
        ORDER BY lower(name),id"""
    ).fetchall()
    return {"players": saved["players"] if saved else general["players"] if general else [],
            "source": "event" if saved else "general", "roster": roster}


@api.put("/trainings/{training_id}/lineup")
def save_training_lineup(training_id: int, data: TrainingLineupInput, conn: DB, user: Staff):
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Udalosť sa nenašla.")
    players = clean_lineup(conn, data.players)
    conn.execute(
        """INSERT INTO training_lineups(training_id,players,updated_by) VALUES (%s,%s,%s)
        ON CONFLICT(training_id) DO UPDATE SET players=excluded.players,updated_by=excluded.updated_by,updated_at=now()""",
        (training_id, Jsonb(players), user["id"]),
    )
    return {"ok": True}


class MemberCoachNoteInput(BaseModel):
    note: Annotated[str, StringConstraints(max_length=4000)] = ""


class MemberSkillInput(BaseModel):
    skill: Short
    level: int = Field(ge=0, le=4)
    note: Note = ""


@api.get("/drills")
def list_drills(conn: DB, _staff: Staff):
    return conn.execute("SELECT * FROM drills ORDER BY lower(title), id").fetchall()


@api.post("/drills")
def create_drill(data: DrillInput, conn: DB, user: Staff):
    return conn.execute(
        """INSERT INTO drills(title,objective,duration_minutes,difficulty,equipment,created_by)
        VALUES (%s,%s,%s,%s,%s,%s) RETURNING *""",
        (data.title, data.objective, data.duration_minutes, data.difficulty, data.equipment, user["id"]),
    ).fetchone()


@api.get("/trainings/{training_id}/workspace")
def training_workspace(training_id: int, conn: DB, user: User):
    training = conn.execute("SELECT id FROM trainings WHERE id=%s", (training_id,)).fetchone()
    if not training:
        raise HTTPException(404, "Udalosť sa nenašla.")
    workspace = conn.execute(
        """SELECT plan,member_note,coach_note FROM training_workspace WHERE training_id=%s""",
        (training_id,),
    ).fetchone() or {"plan": [], "member_note": "", "coach_note": ""}
    if user["role"] not in STAFF_ROLES:
        workspace["coach_note"] = ""
        workspace["feedback"] = conn.execute(
            """SELECT went_well,difficult,next_focus,updated_at FROM training_feedback
            WHERE training_id=%s AND member_id=%s""", (training_id, user["id"]),
        ).fetchone()
    else:
        workspace["feedback"] = conn.execute(
            """SELECT f.member_id,m.name,f.went_well,f.difficult,f.next_focus,f.updated_at
            FROM training_feedback f JOIN members m ON m.id=f.member_id
            WHERE f.training_id=%s ORDER BY lower(m.name),m.id""", (training_id,),
        ).fetchall()
    return workspace


@api.put("/trainings/{training_id}/workspace")
def save_training_workspace(training_id: int, data: TrainingWorkspaceInput, conn: DB, user: Staff):
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Udalosť sa nenašla.")
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
        """INSERT INTO training_workspace(training_id,plan,member_note,coach_note,updated_by)
        VALUES (%s,%s,%s,%s,%s) ON CONFLICT(training_id) DO UPDATE SET
        plan=excluded.plan,member_note=excluded.member_note,coach_note=excluded.coach_note,
        updated_by=excluded.updated_by,updated_at=now()""",
        (training_id, Jsonb(plan), data.member_note, data.coach_note, user["id"]),
    )
    return {"ok": True}


@api.put("/trainings/{training_id}/feedback")
def save_training_feedback(training_id: int, data: TrainingFeedbackInput, conn: DB, user: User):
    if "player" not in user["roles"]:
        raise HTTPException(403, "Spätnú väzbu odovzdávajú členovia.")
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


@api.get("/members/{member_id}/development")
def member_development(member_id: int, conn: DB, _staff: Staff):
    if not conn.execute("SELECT 1 FROM members WHERE id=%s AND 'player'=ANY(club_roles)", (member_id,)).fetchone():
        raise HTTPException(404, "Člen sa nenašiel.")
    note = conn.execute("SELECT note,updated_at FROM member_coach_notes WHERE member_id=%s", (member_id,)).fetchone()
    skills = conn.execute("SELECT skill,level,note,updated_at FROM member_skills WHERE member_id=%s ORDER BY lower(skill)", (member_id,)).fetchall()
    feedback = conn.execute(
        """SELECT t.id AS training_id,t.title,t.starts_at,f.went_well,f.difficult,f.next_focus,f.updated_at
        FROM training_feedback f JOIN trainings t ON t.id=f.training_id WHERE f.member_id=%s
        ORDER BY t.starts_at DESC LIMIT 30""", (member_id,),
    ).fetchall()
    return {"note": note["note"] if note else "", "skills": skills, "feedback": feedback}


@api.put("/members/{member_id}/development/note")
def save_member_coach_note(member_id: int, data: MemberCoachNoteInput, conn: DB, user: Staff):
    if not conn.execute("SELECT 1 FROM members WHERE id=%s AND 'player'=ANY(club_roles)", (member_id,)).fetchone():
        raise HTTPException(404, "Člen sa nenašiel.")
    conn.execute(
        """INSERT INTO member_coach_notes(member_id,note,updated_by) VALUES (%s,%s,%s)
        ON CONFLICT(member_id) DO UPDATE SET note=excluded.note,updated_by=excluded.updated_by,updated_at=now()""",
        (member_id, data.note, user["id"]),
    )
    return {"ok": True}


@api.put("/members/{member_id}/development/skills")
def save_member_skill(member_id: int, data: MemberSkillInput, conn: DB, user: Staff):
    if not conn.execute("SELECT 1 FROM members WHERE id=%s AND 'player'=ANY(club_roles)", (member_id,)).fetchone():
        raise HTTPException(404, "Člen sa nenašiel.")
    conn.execute(
        """INSERT INTO member_skills(member_id,skill,level,note,updated_by) VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT(member_id,skill) DO UPDATE SET level=excluded.level,note=excluded.note,
        updated_by=excluded.updated_by,updated_at=now()""",
        (member_id, data.skill, data.level, data.note, user["id"]),
    )
    return {"ok": True}


class Announcement(BaseModel):
    title: Short
    body: Body
    pinned: bool = False
    audience: Literal["team", "coaches", "selected"] = "team"
    recipient_ids: Annotated[list[int], Field(max_length=1000)] = []
    notify: bool = True
    keep_attachment_ids: Annotated[list[int], Field(max_length=5)] = []
    draft_id: int | None = None


def notice_access(conn, announcement_id, user, *, lock=False):
    notice = conn.execute("SELECT * FROM announcements WHERE id=%s" + (" FOR UPDATE" if lock else ""),
                          (announcement_id,)).fetchone()
    if not notice:
        raise HTTPException(404, "Oznam sa nenašiel.")
    allowed = user["role"] in STAFF_ROLES or notice["audience"] == "team" or (notice["audience"] == "selected" and conn.execute(
        "SELECT 1 FROM announcement_recipients WHERE announcement_id=%s AND member_id=%s",
        (announcement_id,user["id"]),
    ).fetchone())
    if not allowed:
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
        "SELECT id FROM members WHERE active AND role IN ('member','coach') AND (%s='team' OR role='coach')",
        (data.audience,),
    ).fetchall()]


def save_notice(conn, data, user, announcement_id=None):
    if announcement_id is not None:
        old = notice_access(conn, announcement_id, user, lock=True)
        if old["event_id"] is not None:
            # Keep automatic calendar notices in their own notification category.
            channel = "calendar"
        else:
            channel = "announcements"
    else:
        channel = "announcements"
    ids = notice_recipients(conn, data)
    if announcement_id is None:
        announcement_id = conn.execute(
            "INSERT INTO announcements(title,body,pinned,audience) VALUES (%s,%s,%s,%s) RETURNING id",
            (data.title,data.body,data.pinned,data.audience),
        ).fetchone()["id"]
    else:
        conn.execute("UPDATE announcements SET title=%s,body=%s,pinned=%s,audience=%s,updated_at=now() WHERE id=%s",
                     (data.title,data.body,data.pinned,data.audience,announcement_id))
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
    if data.notify:
        push_service.enqueue(conn, ids, channel, data.title, f"#page=announcements&notice={announcement_id}",
                             announcement_id=announcement_id)
    return {"ok":True,"id":announcement_id}


class Message(BaseModel):
    recipient_id: int | None = None
    group_id: int | None = None
    body: Body

    @model_validator(mode="after")
    def validate_destination(self):
        if (self.recipient_id is None) == (self.group_id is None):
            raise ValueError("Vyber jedného adresáta alebo jednu skupinu.")
        return self


@api.get("/announcements")
def announcements(conn: DB, user: User):
    return conn.execute(
        """SELECT a.*, EXISTS (
            SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.member_id=%s
        ) AS is_read,
        ARRAY(SELECT member_id FROM announcement_recipients WHERE announcement_id=a.id) AS recipient_ids,
        COALESCE((SELECT json_agg(json_build_object('id',f.id,'filename',f.filename))
          FROM announcement_attachments f WHERE f.announcement_id=a.id),'[]') AS attachments
        FROM announcements a WHERE %s OR a.audience='team' OR (a.audience='selected' AND EXISTS (
          SELECT 1 FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.member_id=%s))
        ORDER BY a.pinned DESC, a.id DESC LIMIT 100""",
        (user["id"], user["role"] in STAFF_ROLES, user["id"]),
    ).fetchall()


@api.post("/announcements")
def announce(data: Announcement, conn: DB, user: Staff):
    return save_notice(conn,data,user)


@api.put("/announcements/{announcement_id}")
def edit_announcement(announcement_id: int, data: Announcement, conn: DB, user: Staff):
    return save_notice(conn,data,user,announcement_id)


@api.delete("/announcements/{announcement_id}")
def delete_announcement(announcement_id: int, conn: DB, user: Staff):
    notice_access(conn,announcement_id,user,lock=True)
    conn.execute("DELETE FROM announcements WHERE id=%s", (announcement_id,))
    return {"ok":True}


@api.get("/announcement-recipients")
def announcement_contacts(conn: DB, _user: Staff):
    return conn.execute("SELECT id,name,role FROM members WHERE active AND role IN ('member','coach') ORDER BY name,id").fetchall()


@api.post("/announcement-drafts")
def create_announcement_draft(conn: DB, user: Staff):
    conn.execute("DELETE FROM announcement_drafts WHERE created_at<now()-interval '1 day'")
    return conn.execute("INSERT INTO announcement_drafts(member_id) VALUES (%s) RETURNING id", (user["id"],)).fetchone()


@api.post("/announcement-drafts/{draft_id}/attachments")
async def upload_announcement_attachment(draft_id: int, request: Request, conn: DB, user: Staff):
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
def pin_announcement(announcement_id: int, data: Pin, conn: DB, _staff: Staff):
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
def add_place(data: Place, conn: DB, _staff: Staff):
    conn.execute("INSERT INTO places (name) VALUES (%s) ON CONFLICT DO NOTHING", (data.name,))
    return {"ok": True}


@api.get("/documents")
def documents(conn: DB, _user: User):
    return conn.execute(
        "SELECT id, title, filename, created_at FROM documents ORDER BY id DESC"
    ).fetchall()


@api.post("/documents")
async def upload_document(request: Request, conn: DB, _staff: Staff):
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
def delete_document(document_id: int, conn: DB, _staff: Staff):
    conn.execute("DELETE FROM documents WHERE id=%s", (document_id,))
    return {"ok": True}


def chat_user(user: User):
    if user["role"] not in ("member", "coach"):
        raise HTTPException(403, "Klubové správy sú určené členom a trénerom.")
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
        group["system_key"] == "team"
        or (group["system_key"] == "coaches" and user["role"] == "coach")
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
        roles = ["coach"] if group["system_key"] == "coaches" else ["coach", "member"]
        return conn.execute(
            """SELECT id, name, role FROM members WHERE active AND password_hash IS NOT NULL
            AND role=ANY(%s) ORDER BY name, id""", (roles,),
        ).fetchall()
    return conn.execute(
        """SELECT m.id, m.name, m.role FROM chat_group_members gm
        JOIN members m ON m.id=gm.member_id WHERE gm.group_id=%s AND m.active
        AND m.password_hash IS NOT NULL AND m.role IN ('member', 'coach') ORDER BY m.name, m.id""",
        (group["id"],),
    ).fetchall()


def validate_group_members(conn, data, user):
    if user["role"] != "coach":
        raise HTTPException(403, "Skupiny vytvárajú a upravujú tréneri.")
    member_ids = set(data.member_ids) | {user["id"]}
    found = conn.execute(
        """SELECT id FROM members WHERE id=ANY(%s) AND active AND password_hash IS NOT NULL
        AND role IN ('member', 'coach')""", (list(member_ids),),
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
        SELECT r.*, m.name, m.active, 'private' AS type,
        (SELECT count(*) FROM messages WHERE sender_id=r.contact_id AND recipient_id=%s
         AND read_at IS NULL) AS unread
        FROM recent r JOIN members m ON m.id=r.contact_id
        WHERE m.role IN ('coach', 'member') ORDER BY r.id DESC""",
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
        WHERE g.system_key='team' OR (g.system_key='coaches' AND %s='coach')
        OR (g.system_key IS NULL AND EXISTS (
            SELECT 1 FROM chat_group_members gm WHERE gm.group_id=g.id AND gm.member_id=%s
        ))
        ORDER BY g.system_key IS NULL, latest.id DESC NULLS LAST, g.id""",
        (user["id"], user["id"], user["role"], user["id"]),
    ).fetchall()
    # Default rooms remain visible before their first message.
    return groups + private


@api.get("/contacts")
def contacts(conn: DB, user: ChatUser):
    return conn.execute(
        """SELECT id, name, role FROM members WHERE active AND password_hash IS NOT NULL
        AND role IN ('member', 'coach') AND id<>%s ORDER BY name, id""", (user["id"],),
    ).fetchall()


@api.get("/chat-groups/{group_id}")
def group_detail(group_id: int, conn: DB, user: ChatUser):
    group = accessible_group(conn, group_id, user)
    return {**group, "members": group_participants(conn, group),
            "can_manage": user["role"] == "coach" and group["system_key"] is None}


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


@api.get("/messages")
def messages(conn: DB, user: ChatUser, before: int | None = None,
             contact_id: int | None = None, group_id: int | None = None):
    if group_id is not None:
        if contact_id is not None:
            raise HTTPException(422, "Vyber jednu konverzáciu.")
        accessible_group(conn, group_id, user)
        return conn.execute(
            """SELECT p.*, s.name AS sender FROM messages p JOIN members s ON s.id=p.sender_id
            WHERE p.group_id=%s AND p.id<%s ORDER BY p.id DESC LIMIT 200""",
            (group_id, before or 9223372036854775807),
        ).fetchall()
    return conn.execute(
        """SELECT p.*, s.name AS sender, r.name AS recipient FROM messages p
        JOIN members s ON s.id=p.sender_id JOIN members r ON r.id=p.recipient_id
        WHERE p.group_id IS NULL AND (sender_id=%s OR recipient_id=%s) AND p.id < %s
        AND s.role IN ('member', 'coach') AND r.role IN ('member', 'coach')
        AND (%s::bigint IS NULL OR sender_id=%s OR recipient_id=%s)
        ORDER BY p.id DESC LIMIT 200""",
        (user["id"], user["id"], before or 9223372036854775807, contact_id, contact_id, contact_id),
    ).fetchall()


@api.post("/messages")
def send_message(data: Message, conn: DB, user: ChatUser):
    if data.group_id is not None:
        accessible_group(conn, data.group_id, user, lock=True)
        message = conn.execute(
            "INSERT INTO messages (sender_id, group_id, body) VALUES (%s,%s,%s) RETURNING id",
            (user["id"], data.group_id, data.body),
        ).fetchone()
    else:
        target = conn.execute(
            """SELECT id FROM members WHERE id=%s AND id<>%s AND active
            AND role IN ('member', 'coach') AND password_hash IS NOT NULL""",
            (data.recipient_id, user["id"]),
        ).fetchone()
        if not target:
            raise HTTPException(404, "Adresát sa nenašiel.")
        message = conn.execute(
            "INSERT INTO messages (sender_id, recipient_id, body) VALUES (%s,%s,%s) RETURNING id",
            (user["id"], target["id"], data.body),
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
    action: Literal["used", "charged", "stored", "damaged", "retired"]
    note: Note = ""


@api.get("/batteries")
def batteries(conn: DB, _user: User):
    return conn.execute(
        """SELECT b.*, (SELECT action FROM battery_events WHERE code=b.code ORDER BY id DESC LIMIT 1) AS status,
        (SELECT count(*) FROM battery_events WHERE code=b.code AND action='charged') AS charges
        FROM batteries b ORDER BY b.code"""
    ).fetchall()


@api.post("/batteries")
def add_battery(data: Battery, conn: DB, _staff: Staff):
    result = conn.execute("INSERT INTO batteries VALUES (%s,%s) ON CONFLICT DO NOTHING",
                          (data.code, data.label))
    if not result.rowcount:
        raise HTTPException(409, "Batéria s týmto kódom už existuje.")
    return {"ok": True}


@api.get("/batteries/{code}/events")
def events(code: Code, conn: DB, _user: User):
    return conn.execute(
        """SELECT e.*, CASE WHEN m.role='superadmin' THEN 'Systém'
        ELSE COALESCE(m.name, 'Odstránený účet') END AS name
        FROM battery_events e LEFT JOIN members m ON m.id=e.actor_id
        WHERE code=%s ORDER BY e.id DESC LIMIT 100""", (code,)
    ).fetchall()


@api.post("/batteries/{code}/events")
def add_event(code: Code, data: BatteryEvent, conn: DB, user: User):
    if user["role"] == "member" and data.action != "used":
        raise HTTPException(403, "Člen môže zaznamenať iba použitie batérie.")
    if not conn.execute("SELECT 1 FROM batteries WHERE code=%s FOR UPDATE", (code,)).fetchone():
        raise HTTPException(404, "Batéria sa nenašla.")
    if data.request_id is not None:
        previous = conn.execute("SELECT code,actor_id,action,note FROM battery_events WHERE request_id=%s", (data.request_id,)).fetchone()
        if previous:
            if (previous["code"],previous["actor_id"],previous["action"],previous["note"]) != (code,user["id"],data.action,data.note):
                raise HTTPException(409, "Identifikátor záznamu už bol použitý.")
            return {"ok": True}
    last = conn.execute("SELECT action FROM battery_events WHERE code=%s ORDER BY id DESC LIMIT 1",
                        (code,)).fetchone()
    status = last["action"] if last else None
    if status == "retired" or (status == "damaged" and data.action not in {"damaged", "retired"}):
        raise HTTPException(409, "Batéria je poškodená alebo vyradená.")
    if data.action == "retired" and user["role"] not in STAFF_ROLES:
        raise HTTPException(403, "Batériu môže vyradiť iba tréner alebo superadmin.")
    # A stable request id makes retrying a scanned action safe after a lost response.
    inserted = conn.execute(
        """INSERT INTO battery_events (code,actor_id,action,note,request_id) VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING""",
        (code,user["id"],data.action,data.note,data.request_id),
    )
    if not inserted.rowcount:
        raise HTTPException(409, "Identifikátor záznamu už bol použitý.")
    return {"ok": True}


@api.get("/batteries/{code}/label.svg")
def label(code: Code, conn: DB, _staff: Staff):
    if not conn.execute("SELECT 1 FROM batteries WHERE code=%s", (code,)).fetchone():
        raise HTTPException(404, "Batéria sa nenašla.")
    qr = qrcode.make(f"{PUBLIC_URL}/#battery={code}", image_factory=qrcode.image.svg.SvgPathImage)
    return Response(qr.to_string(), media_type="image/svg+xml")


class ScanRequest(BaseModel):
    value: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2048)]
    event_id: int | None = Field(None, gt=0)


def scan_value(value):
    # Old battery QR labels contain a portal URL; barcode labels contain just LF-B… .
    if value.startswith(('https://','http://')):
        link=urlsplit(value)
        if (link.scheme,link.netloc,link.path.rstrip('/')) != (url.scheme,url.netloc,PREFIX):
            raise HTTPException(422,'Kód nepatrí tomuto klubu.')
        parameters=parse_qs(link.fragment)
        value=parameters.get('battery',[''])[0]
    if value.startswith('LF-B'):
        try:
            return 'battery',TypeAdapter(Code).validate_python(value)
        except ValueError:
            raise HTTPException(422,'Kód batérie musí mať LF-B a 2 až 6 číslic, napríklad LF-B01.') from None
    if re.fullmatch(r'LF-M:[A-Za-z0-9_-]{43}',value):
        return 'member',value[5:]
    raise HTTPException(422,'Nerozpoznaný kód. Použi klubový kód batérie alebo členský QR.')


@api.get('/scan/events')
def scan_events(conn:DB, _staff:Staff, day:CalendarDate | None = None):
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
def create_private_scan_event(data:PrivateScanEvent,conn:DB,user:Staff):
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
    if kind=='battery':
        battery=conn.execute(
            """SELECT b.*,(SELECT action FROM battery_events WHERE code=b.code ORDER BY id DESC LIMIT 1) AS status
            FROM batteries b WHERE b.code=%s""",(code,),
        ).fetchone()
        if not battery:
            if user['role'] not in STAFF_ROLES:
                raise HTTPException(404,'Batéria nie je evidovaná. Požiadaj trénera o jej pridanie.')
            return {'type':'battery','exists':False,'code':code}
        return {'type':'battery','exists':True,**battery}
    if user['role'] not in STAFF_ROLES:
        raise HTTPException(403,'Členské QR kódy môže skenovať iba tréner.')
    # Match the same locking order as attendance edits and event deletion.
    if data.event_id is not None:
        event=lock_training(conn,data.event_id)
        if event['cancelled'] or event['starts_at']>datetime.now(timezone.utc) or (event['ends_at'] and event['ends_at']<datetime.now(timezone.utc)):
            raise HTTPException(409,'Dochádzku možno zapísať iba počas prebiehajúcej alebo začatej nezrušenej udalosti.')
    person=conn.execute(
        "SELECT id,name FROM members WHERE card_token=%s AND 'player'=ANY(club_roles) AND active FOR UPDATE",(code,),
    ).fetchone()
    if not person:
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


def digital_card(conn,member_id):
    card=conn.execute(
        """UPDATE members SET card_token=COALESCE(card_token,%s)
        WHERE id=%s AND 'player'=ANY(club_roles) AND active RETURNING id,name,card_token""",
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
    if 'player' not in user['roles']:
        raise HTTPException(403,'Členský QR je určený členom tímu.')
    return digital_card(conn,user['id'])


@api.get('/me/card.svg')
def my_card_qr(conn:DB,user:User):
    if 'player' not in user['roles']:
        raise HTTPException(403,'Členský QR je určený členom tímu.')
    return card_qr(conn,user['id'])


@api.get('/members/{member_id}/card')
def member_card(member_id:int,conn:DB,_staff:Staff):
    return digital_card(conn,member_id)


@api.get('/members/{member_id}/card.svg')
def member_card_qr(member_id:int,conn:DB,_staff:Staff):
    return card_qr(conn,member_id)


@api.post('/members/{member_id}/card/reset')
def reset_member_card(member_id:int,conn:DB,_staff:Staff):
    if not conn.execute("UPDATE members SET card_token=%s WHERE id=%s AND 'player'=ANY(club_roles) AND active",
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
