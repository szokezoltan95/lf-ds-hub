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
from pydantic import AwareDatetime, BaseModel, Field, StringConstraints

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
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254,
                                        pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]
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


class AdminCredentials(BaseModel):
    email: Email
    password: Password


@asynccontextmanager
async def lifespan(_app):
    with connect() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(81364, 1)")
        conn.execute((ROOT / "schema.sql").read_text(), prepare=False)
        email = os.environ["HUB_ADMIN_EMAIL"].strip().lower()
        if not conn.execute("SELECT 1 FROM members WHERE role = 'admin'").fetchone():
            password = os.environ.get("HUB_ADMIN_PASSWORD", "")
            try:
                credentials = AdminCredentials(email=email, password=password)
            except ValueError:
                raise RuntimeError("Set a valid HUB_ADMIN_EMAIL and a 12–128 character HUB_ADMIN_PASSWORD") from None
            conn.execute(
                "INSERT INTO members (email, name, role, password_hash) VALUES (%s, %s, 'admin', %s)",
                (credentials.email, "Tréner", password_hash(credentials.password)),
            )
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
    if is_api or request.url.path in {f"{PREFIX}/", f"{PREFIX}/sw.js", f"{PREFIX}/index.html"}:
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


def admin(user: User):
    if user["role"] != "admin":
        raise HTTPException(403, "Tento úkon môže vykonať iba správca.")
    return user


Admin = Annotated[dict, Depends(admin, scope="function")]


class Login(BaseModel):
    email: Email
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class Invite(BaseModel):
    name: Short
    email: Email


class Accept(BaseModel):
    token: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]
    password: Password


class Active(BaseModel):
    active: bool


@api.get("/health")
def health(conn: DB):
    conn.execute("SELECT 1")
    return {"status": "ok"}


@api.post("/login")
def login(data: Login, response: Response, conn: DB):
    member = conn.execute(
        "SELECT id, active, password_hash FROM members WHERE email = %s FOR UPDATE", (data.email,)
    ).fetchone()
    if not member or not member["active"] or not member["password_hash"]:
        raise HTTPException(401, "Nesprávny e-mail alebo heslo.")
    attempts = conn.execute(
        """INSERT INTO login_attempts VALUES (%s, 1, now()) ON CONFLICT (email) DO UPDATE
        SET attempts = CASE WHEN login_attempts.window_started < now() - interval '15 minutes'
        THEN 1 ELSE least(login_attempts.attempts + 1, 11) END,
        window_started = CASE WHEN login_attempts.window_started < now() - interval '15 minutes'
        THEN now() ELSE login_attempts.window_started END RETURNING attempts""", (data.email,)
    ).fetchone()["attempts"]
    if attempts > 10:
        conn.commit()
        raise HTTPException(429, "Skús sa prihlásiť neskôr.")
    saved = member["password_hash"]
    if not hmac.compare_digest(saved, password_hash(data.password, saved.split(":")[0])):
        conn.commit()
        raise HTTPException(401, "Nesprávny e-mail alebo heslo.")
    conn.execute("DELETE FROM login_attempts WHERE email = %s", (data.email,))
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


@api.get("/members")
def members(conn: DB, _admin: Admin):
    return conn.execute(
        """SELECT id, email, name, role, active, password_hash IS NOT NULL AS registered
        FROM members ORDER BY name, id"""
    ).fetchall()


@api.post("/members/invite")
def invite(data: Invite, conn: DB, _admin: Admin):
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


@api.post("/members/{member_id}/reset")
def reset_member_password(member_id: int, conn: DB, _admin: Admin):
    token = secrets.token_urlsafe(32)
    member = conn.execute(
        """UPDATE members SET invite_hash=%s, invite_until=now() + interval '7 days'
        WHERE id=%s AND active AND role='member' AND password_hash IS NOT NULL RETURNING id""",
        (digest(token), member_id),
    ).fetchone()
    if not member:
        raise HTTPException(404, "Aktívny členský účet sa nenašiel.")
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
def set_active(member_id: int, data: Active, conn: DB, _admin: Admin):
    member = conn.execute(
        "UPDATE members SET active = %s WHERE id = %s AND role = 'member' RETURNING id",
        (data.active, member_id)
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
        """SELECT t.*, p.response, p.note, p.attended FROM trainings t
        LEFT JOIN participation p ON p.training_id = t.id AND p.member_id = %s
        ORDER BY (t.starts_at >= now()) DESC,
        CASE WHEN t.starts_at >= now() THEN t.starts_at END,
        t.starts_at DESC LIMIT 300""", (user["id"],)
    ).fetchall()


@api.post("/trainings")
def create_training(data: Training, conn: DB, _admin: Admin):
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
            """INSERT INTO trainings (title, starts_at, location, instructions, series_id)
            VALUES (%s, %s, %s, %s, %s)""",
            [(data.title, stamp, data.location, data.instructions, series) for stamp in starts],
        )
    return {"ok": True}


def lock_training(conn, training_id):
    training = conn.execute("SELECT * FROM trainings WHERE id = %s FOR UPDATE",
                            (training_id,)).fetchone()
    if not training:
        raise HTTPException(404, "Tréning sa nenašiel.")
    return training


@api.put("/trainings/{training_id}")
def edit_training(training_id: int, data: TrainingEdit, conn: DB, _admin: Admin):
    training = lock_training(conn, training_id)
    if training["cancelled"]:
        raise HTTPException(409, "Tréning bol zrušený.")
    conn.execute(
        "UPDATE trainings SET title=%s, starts_at=%s, location=%s, instructions=%s WHERE id=%s",
        (data.title, data.starts_at, data.location, data.instructions, training_id)
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
def cancel_training(training_id: int, conn: DB, _admin: Admin):
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
def roster(training_id: int, conn: DB, _admin: Admin):
    if not conn.execute("SELECT 1 FROM trainings WHERE id=%s", (training_id,)).fetchone():
        raise HTTPException(404, "Tréning sa nenašiel.")
    return conn.execute(
        """SELECT m.id, m.name, p.response, p.note, p.attended FROM members m
        LEFT JOIN participation p ON p.member_id=m.id AND p.training_id=%s
        WHERE m.role='member' AND ((m.active AND m.password_hash IS NOT NULL) OR p.member_id IS NOT NULL)
        ORDER BY m.name, m.id""",
        (training_id,)
    ).fetchall()


@api.put("/trainings/{training_id}/attendance/{member_id}")
def attendance(training_id: int, member_id: int, data: Attendance, conn: DB, _admin: Admin):
    training = lock_training(conn, training_id)
    if training["cancelled"] or training["starts_at"] > datetime.now(timezone.utc):
        raise HTTPException(409, "Dochádzku možno zapísať od začiatku tréningu.")
    if not conn.execute("SELECT 1 FROM members WHERE id=%s AND role='member'", (member_id,)).fetchone():
        raise HTTPException(404, "Člen sa nenašiel.")
    conn.execute(
        """INSERT INTO participation (training_id, member_id, attended) VALUES (%s,%s,%s)
        ON CONFLICT (training_id, member_id) DO UPDATE SET attended=excluded.attended""",
        (training_id, member_id, data.attended),
    )
    return {"ok": True}


@api.get("/members/{member_id}/attendance")
def member_attendance(member_id: int, conn: DB, _admin: Admin):
    return conn.execute(
        """SELECT t.title, t.starts_at, p.attended FROM participation p
        JOIN trainings t ON t.id=p.training_id
        WHERE p.member_id=%s AND p.attended IS NOT NULL ORDER BY t.starts_at DESC""",
        (member_id,)
    ).fetchall()


class Announcement(BaseModel):
    title: Short
    body: Body


class Message(BaseModel):
    recipient_id: int
    body: Body


@api.get("/announcements")
def announcements(conn: DB, _user: User):
    return conn.execute("SELECT * FROM announcements ORDER BY id DESC LIMIT 100").fetchall()


@api.post("/announcements")
def announce(data: Announcement, conn: DB, _admin: Admin):
    conn.execute("INSERT INTO announcements (title, body) VALUES (%s,%s)", (data.title, data.body))
    return {"ok": True}


@api.get("/contacts")
def contacts(conn: DB, user: User):
    role = "member" if user["role"] == "admin" else "admin"
    return conn.execute("SELECT id, name FROM members WHERE active AND role=%s AND password_hash IS NOT NULL ORDER BY name",
                        (role,)).fetchall()


@api.get("/messages")
def messages(conn: DB, user: User, before: int | None = None):
    return conn.execute(
        """SELECT p.*, s.name AS sender, r.name AS recipient FROM messages p
        JOIN members s ON s.id=p.sender_id JOIN members r ON r.id=p.recipient_id
        WHERE (sender_id=%s OR recipient_id=%s) AND p.id < %s
        ORDER BY p.id DESC LIMIT 200""", (user["id"], user["id"], before or 9223372036854775807)
    ).fetchall()


@api.post("/messages")
def send_message(data: Message, conn: DB, user: User):
    role = "member" if user["role"] == "admin" else "admin"
    target = conn.execute("SELECT id FROM members WHERE id=%s AND active AND role=%s AND password_hash IS NOT NULL",
                          (data.recipient_id, role)).fetchone()
    if not target:
        raise HTTPException(404, "Adresát sa nenašiel.")
    conn.execute("INSERT INTO messages (sender_id, recipient_id, body) VALUES (%s,%s,%s)",
                 (user["id"], target["id"], data.body))
    return {"ok": True}


@api.post("/messages/read")
def read_messages(ids: Annotated[list[int], Field(max_length=200)], conn: DB, user: User):
    conn.execute("UPDATE messages SET read_at=now() WHERE recipient_id=%s AND id=ANY(%s) AND read_at IS NULL",
                 (user["id"], ids))
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
def add_battery(data: Battery, conn: DB, _admin: Admin):
    result = conn.execute("INSERT INTO batteries VALUES (%s,%s) ON CONFLICT DO NOTHING",
                          (data.code, data.label))
    if not result.rowcount:
        raise HTTPException(409, "Batéria s týmto kódom už existuje.")
    return {"ok": True}


@api.get("/batteries/{code}/events")
def events(code: Code, conn: DB, _user: User):
    return conn.execute(
        """SELECT e.*, m.name FROM battery_events e JOIN members m ON m.id=e.actor_id
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
    if data.action == "retired" and user["role"] != "admin":
        raise HTTPException(403, "Batériu môže vyradiť iba správca.")
    conn.execute("INSERT INTO battery_events (code, actor_id, action, note) VALUES (%s,%s,%s,%s)",
                 (code, user["id"], data.action, data.note))
    return {"ok": True}


@api.get("/batteries/{code}/label.svg")
def label(code: Code, conn: DB, _admin: Admin):
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
