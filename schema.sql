CREATE TABLE IF NOT EXISTS members (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text UNIQUE,
    name text NOT NULL,
    role text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    password_hash text,
    invite_hash text UNIQUE,
    invite_until timestamptz,
    CONSTRAINT members_account_check CHECK (
        (role = 'superadmin' AND email IS NULL) OR
        (role IN ('coach', 'member') AND email IS NOT NULL)
    )
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
    email text PRIMARY KEY,
    attempts integer NOT NULL,
    window_started timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS trainings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL,
    starts_at timestamptz NOT NULL,
    location text NOT NULL,
    instructions text NOT NULL,
    cancelled boolean NOT NULL DEFAULT false,
    series_id uuid
);
CREATE TABLE IF NOT EXISTS participation (
    training_id bigint NOT NULL REFERENCES trainings(id),
    member_id bigint NOT NULL REFERENCES members(id),
    response text CHECK (response IN ('yes', 'no', 'maybe')),
    note text NOT NULL DEFAULT '',
    attended boolean,
    PRIMARY KEY (training_id, member_id)
);
CREATE TABLE IF NOT EXISTS announcements (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sender_id bigint NOT NULL REFERENCES members(id),
    recipient_id bigint NOT NULL REFERENCES members(id),
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);
CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages(sender_id, id DESC);
CREATE INDEX IF NOT EXISTS messages_recipient_idx ON messages(recipient_id, id DESC);
CREATE TABLE IF NOT EXISTS batteries (
    code text PRIMARY KEY,
    label text NOT NULL
);
CREATE TABLE IF NOT EXISTS battery_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL REFERENCES batteries(code),
    actor_id bigint REFERENCES members(id),
    action text NOT NULL CHECK (action IN ('used', 'charged', 'stored', 'damaged', 'retired')),
    note text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS battery_events_code_idx ON battery_events(code, id DESC);

-- Upgrade the original email-based administrator without losing its history.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'members'::regclass AND conname = 'members_account_check'
    ) THEN
        ALTER TABLE members DROP CONSTRAINT members_role_check;
        ALTER TABLE members ALTER COLUMN email DROP NOT NULL;
        DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE role = 'admin');
        UPDATE members SET role = 'coach' WHERE role = 'admin';
        ALTER TABLE members ADD CONSTRAINT members_account_check CHECK (
            (role = 'superadmin' AND email IS NULL) OR
            (role IN ('coach', 'member') AND email IS NOT NULL)
        );
        ALTER TABLE battery_events ALTER COLUMN actor_id DROP NOT NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS members_one_superadmin_idx
ON members (role) WHERE role = 'superadmin';

ALTER TABLE trainings ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'training'
    CHECK (kind IN ('training', 'match', 'meeting'));
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS ends_at timestamptz
    CHECK (ends_at > starts_at);
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS places (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS announcement_reads (
    announcement_id bigint NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    PRIMARY KEY (announcement_id, member_id)
);
CREATE TABLE IF NOT EXISTS documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL,
    filename text NOT NULL,
    content bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_groups (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    system_key text UNIQUE CHECK (system_key IN ('team', 'coaches')),
    created_by bigint REFERENCES members(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO chat_groups (name, system_key) VALUES ('Celý tím', 'team'), ('Tréneri', 'coaches')
ON CONFLICT (system_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS chat_group_members (
    group_id bigint NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, member_id)
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS group_id bigint REFERENCES chat_groups(id);
ALTER TABLE messages ALTER COLUMN recipient_id DROP NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid='messages'::regclass AND conname='messages_destination_check') THEN
        ALTER TABLE messages ADD CONSTRAINT messages_destination_check CHECK (
            (recipient_id IS NOT NULL AND group_id IS NULL) OR
            (recipient_id IS NULL AND group_id IS NOT NULL)
        );
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS messages_group_idx ON messages(group_id, id DESC);
CREATE TABLE IF NOT EXISTS chat_group_reads (
    group_id bigint NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    last_message_id bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, member_id)
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS pwa_show_card boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS pwa_show_popup boolean NOT NULL DEFAULT true;

-- Calendar ownership and cascading removal of automatic notices.
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE participation DROP CONSTRAINT IF EXISTS participation_training_id_fkey;
ALTER TABLE participation ADD CONSTRAINT participation_training_id_fkey
    FOREIGN KEY (training_id) REFERENCES trainings(id) ON DELETE CASCADE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS event_id bigint REFERENCES trainings(id) ON DELETE CASCADE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'team'
    CHECK (audience IN ('team', 'coaches', 'selected'));
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS announcement_recipients (
    announcement_id bigint NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    PRIMARY KEY (announcement_id, member_id)
);
CREATE TABLE IF NOT EXISTS announcement_attachments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    announcement_id bigint NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    filename text NOT NULL,
    media_type text NOT NULL,
    content bytea NOT NULL
);
-- Recover only unambiguous original automatic notices, never guess from a title alone.
WITH matches AS (
    SELECT a.id, min(t.id) AS event_id FROM announcements a JOIN trainings t ON
    (a.title = 'Zrušený tréning: ' || t.title AND a.body = 'Termín ' ||
      to_char(t.starts_at AT TIME ZONE 'Europe/Bratislava', 'DD.MM.YYYY HH24:MI') || ' · ' || t.location || ' bol zrušený.')
    OR (a.title = 'Zmena tréningu: ' || t.title AND a.body = 'Nový termín: ' ||
      to_char(t.starts_at AT TIME ZONE 'Europe/Bratislava', 'DD.MM.YYYY HH24:MI') || ' · ' || t.location)
    WHERE a.event_id IS NULL GROUP BY a.id HAVING count(*)=1
)
UPDATE announcements a SET event_id=m.event_id FROM matches m WHERE a.id=m.id;
UPDATE announcements SET title=regexp_replace(title, '^Zrušený tréning: ', 'Zrušená udalosť: ')
    WHERE event_id IS NOT NULL AND title LIKE 'Zrušený tréning: %';
UPDATE announcements SET title=regexp_replace(title, '^Zmena tréningu: ', 'Zmena udalosti: ')
    WHERE event_id IS NOT NULL AND title LIKE 'Zmena tréningu: %';
ALTER TABLE members ADD COLUMN IF NOT EXISTS push_messages boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS push_calendar boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS push_announcements boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS club_roles text[] NOT NULL DEFAULT ARRAY['player']::text[];
UPDATE members SET club_roles=ARRAY['player','coach'] WHERE role='coach' AND club_roles=ARRAY['player']::text[];
UPDATE members SET club_roles=ARRAY['player'] WHERE role='member' AND cardinality(club_roles)=0;
CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='2026-11-18-player-role-optional') THEN
        -- Earlier releases automatically marked every coach as a player.
        UPDATE members SET club_roles=array_remove(club_roles,'player')
            WHERE role='coach' AND 'player'=ANY(club_roles);
        INSERT INTO schema_migrations(version) VALUES ('2026-11-18-player-role-optional');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS role_catalog (
    role_key text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL,
    available boolean NOT NULL DEFAULT true,
    admin_access boolean NOT NULL DEFAULT false,
    can_create_invites boolean NOT NULL DEFAULT false,
    can_assign_invite_roles boolean NOT NULL DEFAULT false
);
ALTER TABLE role_catalog ADD COLUMN IF NOT EXISTS can_create_invites boolean NOT NULL DEFAULT false;
ALTER TABLE role_catalog ADD COLUMN IF NOT EXISTS can_assign_invite_roles boolean NOT NULL DEFAULT false;
DO $ BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='2026-11-18-invite-role-permissions') THEN
        UPDATE role_catalog SET can_create_invites = role_key IN ('coach','club_leader','deputy_leader');
        UPDATE role_catalog SET can_assign_invite_roles = role_key IN ('club_leader','deputy_leader');
        INSERT INTO schema_migrations(version) VALUES ('2026-11-18-invite-role-permissions');
    END IF;
END $;
CREATE TABLE IF NOT EXISTS role_menu_permissions (
    role_key text NOT NULL REFERENCES role_catalog(role_key) ON DELETE CASCADE,
    menu_key text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    PRIMARY KEY(role_key,menu_key)
);
ALTER TABLE role_menu_permissions ADD COLUMN IF NOT EXISTS access_level text;
UPDATE role_menu_permissions SET access_level=CASE WHEN enabled THEN 'edit' ELSE 'none' END
    WHERE access_level IS NULL;
ALTER TABLE role_menu_permissions ALTER COLUMN access_level SET DEFAULT 'none';
ALTER TABLE role_menu_permissions ALTER COLUMN access_level SET NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='role_menu_permissions_access_level_check') THEN
        ALTER TABLE role_menu_permissions ADD CONSTRAINT role_menu_permissions_access_level_check
            CHECK (access_level IN ('none','read','edit'));
    END IF;
END $$;
CREATE TABLE IF NOT EXISTS role_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    role_key text NOT NULL REFERENCES role_catalog(role_key),
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    decided_by bigint REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS role_requests_pending_unique
ON role_requests(member_id,role_key) WHERE status='pending';
CREATE TABLE IF NOT EXISTS hub_settings (
    setting_key text PRIMARY KEY,
    value jsonb NOT NULL
);
INSERT INTO hub_settings(setting_key,value) VALUES ('trial_banner_enabled','true'::jsonb)
ON CONFLICT(setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS push_keys (
    id integer PRIMARY KEY CHECK (id=1), private_key text NOT NULL, public_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL
);
CREATE TABLE IF NOT EXISTS push_notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('messages','calendar','announcements')),
    title text NOT NULL, path text NOT NULL,
    event_id bigint REFERENCES trainings(id) ON DELETE CASCADE,
    announcement_id bigint REFERENCES announcements(id) ON DELETE CASCADE,
    message_id bigint REFERENCES messages(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_deliveries (
    notification_id bigint NOT NULL REFERENCES push_notifications(id) ON DELETE CASCADE,
    subscription_id bigint NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(),
    done boolean NOT NULL DEFAULT false,
    PRIMARY KEY(notification_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS push_pending_idx ON push_deliveries(next_attempt) WHERE NOT done;

CREATE TABLE IF NOT EXISTS announcement_drafts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE announcement_attachments ALTER COLUMN announcement_id DROP NOT NULL;
ALTER TABLE announcement_attachments ADD COLUMN IF NOT EXISTS draft_id bigint
    REFERENCES announcement_drafts(id) ON DELETE CASCADE;

-- Digital membership identifiers are not login credentials.
ALTER TABLE members ADD COLUMN IF NOT EXISTS card_token text;
CREATE UNIQUE INDEX IF NOT EXISTS members_card_token_idx ON members(card_token) WHERE card_token IS NOT NULL;
ALTER TABLE battery_events ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS battery_events_request_id_idx ON battery_events(request_id) WHERE request_id IS NOT NULL;

-- Drone Soccer training workspace: reusable drill library, event plans and private feedback.
CREATE TABLE IF NOT EXISTS drills (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL,
    objective text NOT NULL DEFAULT '',
    duration_minutes integer NOT NULL DEFAULT 10 CHECK (duration_minutes BETWEEN 1 AND 240),
    difficulty text NOT NULL DEFAULT 'basic' CHECK (difficulty IN ('basic','intermediate','advanced')),
    equipment text NOT NULL DEFAULT '',
    created_by bigint REFERENCES members(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS training_workspace (
    training_id bigint PRIMARY KEY REFERENCES trainings(id) ON DELETE CASCADE,
    plan jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(plan)='array'),
    member_note text NOT NULL DEFAULT '',
    coach_note text NOT NULL DEFAULT '',
    updated_by bigint REFERENCES members(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS training_feedback (
    training_id bigint NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    went_well text NOT NULL DEFAULT '',
    difficult text NOT NULL DEFAULT '',
    next_focus text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(training_id, member_id)
);
CREATE TABLE IF NOT EXISTS member_coach_notes (
    member_id bigint PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    note text NOT NULL DEFAULT '',
    updated_by bigint REFERENCES members(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS member_skills (
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    skill text NOT NULL,
    level integer NOT NULL CHECK (level BETWEEN 0 AND 4),
    note text NOT NULL DEFAULT '',
    updated_by bigint REFERENCES members(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(member_id, skill)
);
CREATE TABLE IF NOT EXISTS training_lineups (
    training_id bigint PRIMARY KEY REFERENCES trainings(id) ON DELETE CASCADE,
    players jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(players)='array'),
    updated_by bigint REFERENCES members(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS club_lineup (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
    players jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(players)='array'),
    updated_by bigint REFERENCES members(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
