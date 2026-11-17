import hashlib
import hmac
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg
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
    yield


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
        """SELECT m.id, m.name, m.email, m.role FROM sessions s
        JOIN members m ON m.id = s.member_id
        WHERE s.token_hash = %s AND s.expires_at > now() AND m.active""", (digest(token),)
    ).fetchone()
    if not member:
        raise HTTPException(401, "Prihlás sa do portálu.")
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


class Accept(BaseModel):
    token: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]
    password: Password


class CoachAccount(Invite):
    password: Password


class AccountRole(BaseModel):
    role: Literal["coach", "member"]


class Active(BaseModel):
    active: bool


@api.get("/health")
def health(conn: DB):
    conn.execute("SELECT 1")
    return {"status": "ok"}


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
def members(conn: DB, _staff: Staff):
    return conn.execute(
        """SELECT m.id, m.email, m.name, m.role, m.active,
        m.password_hash IS NOT NULL AS registered,
        (SELECT count(*) FROM participation WHERE member_id=m.id AND attended=true) AS attended_count,
        (SELECT count(*) FROM participation WHERE member_id=m.id AND attended IS NOT NULL) AS recorded_count
        FROM members m WHERE role IN ('member', 'coach') ORDER BY name, id"""
    ).fetchall()


@api.post("/members/invite")
def invite(data: Invite, conn: DB, _staff: Staff):
    token = secrets.token_urlsafe(32)
    member = conn.execute(
        """INSERT INTO members (email, name, role, invite_hash, invite_until)
        VALUES (%s, %s, 'member', %s, now() + interval '7 days')
        ON CONFLICT (email) DO UPDATE SET name = excluded.name, invite_hash = excluded.invite_hash,
        invite_until = excluded.invite_until
        WHERE members.role = 'member' AND members.active AND members.password_hash IS NULL
        RETURNING id""", (data.email, data.name, digest(token))
    ).fetchone()
    if not member:
        raise HTTPException(409, "Tento e-mail už patrí existujúcemu účtu.")
    return {"invite_url": f"{PUBLIC_URL}/#invite={token}"}


@api.post("/members/coaches")
def create_coach(data: CoachAccount, conn: DB, _admin: Superadmin):
    member = conn.execute(
        """INSERT INTO members (email, name, role, password_hash)
        VALUES (%s, %s, 'coach', %s) ON CONFLICT (email) DO NOTHING RETURNING id""",
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
            """UPDATE members SET role=%s, invite_hash=NULL, invite_until=NULL
            WHERE id=%s""", (data.role, member_id),
        )
        conn.execute("DELETE FROM sessions WHERE member_id=%s", (member_id,))
    return {"ok": True}


@api.delete("/members/{member_id}")
def delete_member(member_id: int, conn: DB, _admin: Superadmin):
    member = conn.execute(
        "SELECT email FROM members WHERE id=%s AND role='member' FOR UPDATE", (member_id,),
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
    conn.execute(
        """UPDATE members SET password_hash = %s, invite_hash = NULL, invite_until = NULL
        WHERE id = %s""", (password_hash(data.password), member["id"])
    )
    conn.execute("DELETE FROM sessions WHERE member_id = %s", (member["id"],))
    return {"ok": True}


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
        (SELECT json_build_object(
            'yes', count(*) FILTER (WHERE r.response='yes'),
            'no', count(*) FILTER (WHERE r.response='no'),
            'maybe', count(*) FILTER (WHERE r.response='maybe'),
            'unanswered', count(*) FILTER (WHERE r.response IS NULL),
            'attendance_pending', count(*) FILTER (WHERE r.attended IS NULL))
         FROM members m LEFT JOIN participation r ON r.member_id=m.id AND r.training_id=t.id
         WHERE m.role='member' AND m.active AND m.password_hash IS NOT NULL) AS counts
        FROM trainings t
        LEFT JOIN participation p ON p.training_id = t.id AND p.member_id = %s
        ORDER BY (t.starts_at >= now()) DESC,
        CASE WHEN t.starts_at >= now() THEN t.starts_at END,
        t.starts_at DESC LIMIT 300""", (user["id"],)
    ).fetchall()


@api.post("/trainings")
def create_training(data: Training, conn: DB, _staff: Staff):
    series = uuid4() if data.weeks > 1 else None
    start = data.starts_at.astimezone(CLUB_ZONE)
    starts = [start + timedelta(weeks=week) for week in range(data.weeks)]
    if any(
        stamp.astimezone(timezone.utc).astimezone(CLUB_ZONE).replace(tzinfo=None) != stamp.replace(tzinfo=None)
        or stamp.replace(fold=0).utcoffset() != stamp.replace(fold=1).utcoffset()
        for stamp in starts
    ):
        raise HTTPException(422, "Séria obsahuje nejednoznačný termín pri zmene času.")
    with conn.cursor() as cursor:
        cursor.executemany(
            """INSERT INTO trainings (title, starts_at, location, instructions, series_id, kind, ends_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            [(data.title, stamp, data.location, data.instructions, series, data.kind,
              stamp.astimezone(timezone.utc) + (data.ends_at - data.starts_at) if data.ends_at else None) for stamp in starts],
        )
    return {"ok": True}


def lock_training(conn, training_id):
    training = conn.execute("SELECT * FROM trainings WHERE id = %s FOR UPDATE",
                            (training_id,)).fetchone()
    if not training:
        raise HTTPException(404, "Tréning sa nenašiel.")
    return training


@api.put("/trainings/{training_id}")
def edit_training(training_id: int, data: TrainingEdit, conn: DB, _staff: Staff):
    training = lock_training(conn, training_id)
    if training["cancelled"]:
        raise HTTPException(409, "Tréning bol zrušený.")
    conn.execute(
        """UPDATE trainings SET title=%s, starts_at=%s, location=%s, instructions=%s,
        kind=%s, ends_at=%s, updated_at=now() WHERE id=%s""",
        (data.title, data.starts_at, data.location, data.instructions, data.kind, data.ends_at, training_id)
    )
    if training["starts_at"] != data.starts_at or training["location"] != data.location:
        if training["starts_at"] > datetime.now(timezone.utc):
            conn.execute("UPDATE participation SET response=NULL, note='' WHERE training_id=%s",
                         (training_id,))
        conn.execute(
            "INSERT INTO announcements (title, body) VALUES (%s,%s)",
            (f"Zmena tréningu: {data.title}",
             f"Nový termín: {club_date(data.starts_at)} · {data.location}"),
        )
    return {"ok": True}


@api.post("/trainings/{training_id}/cancel")
def cancel_training(training_id: int, conn: DB, _staff: Staff):
    training = lock_training(conn, training_id)
    if not training["cancelled"]:
        conn.execute("UPDATE trainings SET cancelled=true WHERE id=%s", (training_id,))
        conn.execute(
            "INSERT INTO announcements (title, body) VALUES (%s,%s)",
            (f"Zrušený tréning: {training['title']}",
             f"Termín {club_date(training['starts_at'])} · {training['location']} bol zrušený."),
        )
    return {"ok": True}


def club_date(timestamp):
    return timestamp.astimezone(CLUB_ZONE).strftime("%d.%m.%Y %H:%M")


@api.put("/trainings/{training_id}/rsvp")
def rsvp(training_id: int, data: RSVP, conn: DB, user: User):
    if user["role"] != "member":
        raise HTTPException(403, "Účasť potvrdzujú členovia.")
    training = lock_training(conn, training_id)
    if training["cancelled"] or training["starts_at"] <= datetime.now(timezone.utc):
        raise HTTPException(409, "Na tento tréning sa už nedá prihlásiť.")
    conn.execute(
        """INSERT INTO participation (training_id, member_id, response, note) VALUES (%s,%s,%s,%s)
        ON CONFLICT (training_id, member_id) DO UPDATE SET response=excluded.response, note=excluded.note""",
        (training_id, user["id"], data.response, data.note),
    )
    return {"ok": True}


@api.get("/trainings/{training_id}/roster")
def roster(training_id: int, conn: DB, _staff: Staff):
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Tréning sa nenašiel.")
    return conn.execute(
        """SELECT m.id, m.name, p.response, p.note, p.attended FROM members m
        LEFT JOIN participation p ON p.member_id=m.id AND p.training_id=%s
        WHERE (m.role='member' AND m.active AND m.password_hash IS NOT NULL) OR p.member_id IS NOT NULL
        ORDER BY m.name, m.id""",
        (training_id,)
    ).fetchall()


@api.put("/trainings/{training_id}/attendance/{member_id}")
def attendance(training_id: int, member_id: int, data: Attendance, conn: DB, _staff: Staff):
    training = lock_training(conn, training_id)
    if training["cancelled"] or training["starts_at"] > datetime.now(timezone.utc):
        raise HTTPException(409, "Dochádzku možno zapísať od začiatku tréningu.")
    if not conn.execute(
        "SELECT 1 FROM members WHERE id=%s AND (role='member' OR EXISTS (SELECT 1 FROM participation WHERE member_id=%s AND training_id=%s))",
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
        raise HTTPException(409, "Dochádzku možno zapísať od začiatku tréningu.")
    ids = set(data.member_ids)
    allowed = conn.execute(
        """SELECT id FROM members WHERE id=ANY(%s) AND
        (role='member' OR EXISTS (SELECT 1 FROM participation WHERE member_id=members.id AND training_id=%s))""",
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


@api.get("/members/{member_id}/attendance")
def member_attendance(member_id: int, conn: DB, _staff: Staff):
    return conn.execute(
        """SELECT t.title, t.starts_at, p.attended FROM participation p
        JOIN trainings t ON t.id=p.training_id
        WHERE p.member_id=%s AND p.attended IS NOT NULL ORDER BY t.starts_at DESC""",
        (member_id,)
    ).fetchall()


class Announcement(BaseModel):
    title: Short
    body: Body
    pinned: bool = False


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
        ) AS is_read FROM announcements a ORDER BY a.pinned DESC, a.id DESC LIMIT 100""",
        (user["id"],),
    ).fetchall()


@api.post("/announcements")
def announce(data: Announcement, conn: DB, _staff: Staff):
    conn.execute("INSERT INTO announcements (title, body, pinned) VALUES (%s,%s,%s)",
                 (data.title, data.body, data.pinned))
    return {"ok": True}


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
    if not conn.execute("SELECT 1 FROM announcements WHERE id=%s", (announcement_id,)).fetchone():
        raise HTTPException(404, "Oznam sa nenašiel.")
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
    if not conn.execute("SELECT 1 FROM batteries WHERE code=%s FOR UPDATE", (code,)).fetchone():
        raise HTTPException(404, "Batéria sa nenašla.")
    last = conn.execute("SELECT action FROM battery_events WHERE code=%s ORDER BY id DESC LIMIT 1",
                        (code,)).fetchone()
    status = last["action"] if last else None
    if status == "retired" or (status == "damaged" and data.action not in {"damaged", "retired"}):
        raise HTTPException(409, "Batéria je poškodená alebo vyradená.")
    if data.action == "retired" and user["role"] not in STAFF_ROLES:
        raise HTTPException(403, "Batériu môže vyradiť iba tréner alebo superadmin.")
    conn.execute("INSERT INTO battery_events (code, actor_id, action, note) VALUES (%s,%s,%s,%s)",
                 (code, user["id"], data.action, data.note))
    return {"ok": True}


@api.get("/batteries/{code}/label.svg")
def label(code: Code, conn: DB, _staff: Staff):
    if not conn.execute("SELECT 1 FROM batteries WHERE code=%s", (code,)).fetchone():
        raise HTTPException(404, "Batéria sa nenašla.")
    qr = qrcode.make(f"{PUBLIC_URL}/#battery={code}", image_factory=qrcode.image.svg.SvgPathImage)
    return Response(qr.to_string(), media_type="image/svg+xml")


app.include_router(api)
if PREFIX:
    @app.get(PREFIX, include_in_schema=False)
    def portal_redirect():
        return RedirectResponse(f"{PUBLIC_URL}/", status_code=308)

app.mount(PREFIX or "/", StaticFiles(directory=os.environ.get("HUB_DIST", ROOT / "dist"), html=True), name="portal")
