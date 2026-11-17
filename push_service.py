"""Durable Web Push queue. All writes share the caller's database transaction."""
import base64
import json
import logging
from urllib.parse import urlsplit
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import webpush, WebPushException


def initialize(conn):
    if conn.execute("SELECT 1 FROM push_keys WHERE id=1").fetchone():
        return
    key = ec.generate_private_key(ec.SECP256R1())
    private = base64.urlsafe_b64encode(key.private_bytes(
        serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption())).decode().rstrip('=')
    public = base64.urlsafe_b64encode(key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)).decode().rstrip('=')
    conn.execute("INSERT INTO push_keys VALUES (1,%s,%s)", (private, public))


def enqueue(conn, recipients, channel, title, path, *, event_id=None, announcement_id=None,
            message_id=None, exclude=None):
    # recipients=None means the current active club. Never include the system account.
    people = conn.execute(
        """SELECT id FROM members WHERE active AND password_hash IS NOT NULL
        AND role IN ('member','coach') AND (%s::bigint[] IS NULL OR id=ANY(%s))
        AND (%s::bigint IS NULL OR id<>%s) AND CASE %s WHEN 'messages' THEN push_messages
        WHEN 'calendar' THEN push_calendar ELSE push_announcements END""", (recipients, recipients, exclude, exclude, channel),
    ).fetchall()
    for person in people:
        notice = conn.execute(
            """INSERT INTO push_notifications (member_id,channel,title,path,event_id,announcement_id,message_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (person['id'], channel, title[:200], path, event_id, announcement_id, message_id),
        ).fetchone()
        conn.execute(
            """INSERT INTO push_deliveries (notification_id,subscription_id)
            SELECT %s,id FROM push_subscriptions WHERE member_id=%s""", (notice['id'], person['id']),
        )


def deliver_one(connect, public_url):
    with connect() as conn:
        job = conn.execute(
            """SELECT d.notification_id,d.subscription_id,d.attempts,s.endpoint,s.p256dh,s.auth,
            n.channel,m.active,m.push_messages,m.push_calendar,m.push_announcements
            FROM push_deliveries d JOIN push_notifications n ON n.id=d.notification_id
            JOIN push_subscriptions s ON s.id=d.subscription_id JOIN members m ON m.id=n.member_id
            WHERE NOT d.done AND d.next_attempt<=now()
            ORDER BY d.next_attempt LIMIT 1 FOR UPDATE OF d SKIP LOCKED"""
        ).fetchone()
        if not job:
            return False
        done = True
        if job['active'] and job['push_' + job['channel']]:
            key = conn.execute("SELECT private_key FROM push_keys WHERE id=1").fetchone()['private_key']
            try:
                webpush({'endpoint': job['endpoint'], 'keys': {'p256dh':job['p256dh'],'auth':job['auth']}},
                        data=json.dumps({'id':job['notification_id']}), vapid_private_key=key,
                        vapid_claims={'sub':'https://' + urlsplit(public_url).hostname}, ttl=86400, timeout=5)
            except WebPushException as error:
                status = error.response.status_code if error.response is not None else None
                if status in (404,410):
                    conn.execute("DELETE FROM push_subscriptions WHERE id=%s", (job['subscription_id'],))
                    return True
                done = job['attempts'] >= 3 or (status is not None and 400<=status<500 and status!=429)
                logging.warning('Web Push delivery failed (HTTP %s)', status)
            except Exception:
                done = job['attempts'] >= 3
                logging.warning('Web Push transport failed')
        conn.execute(
            """UPDATE push_deliveries SET done=%s,attempts=attempts+1,
            next_attempt=now()+interval '1 minute' * power(2,attempts)
            WHERE notification_id=%s AND subscription_id=%s""",
            (done,job['notification_id'],job['subscription_id']),
        )
    return True


def worker(connect, stop, public_url):
    while not stop.is_set():
        try:
            with connect() as conn:
                conn.execute("DELETE FROM push_notifications WHERE created_at<now()-interval '1 day'")
                conn.execute("DELETE FROM announcement_drafts WHERE created_at<now()-interval '1 day'")
            for _ in range(30):
                if stop.is_set() or not deliver_one(connect, public_url):
                    break
        except Exception:
            logging.exception('Web Push worker paused after database error')
        stop.wait(2)
