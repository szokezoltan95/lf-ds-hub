CREATE TABLE IF NOT EXISTS members (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text UNIQUE NOT NULL,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'member')),
    active boolean NOT NULL DEFAULT true,
    password_hash text,
    invite_hash text UNIQUE,
    invite_until timestamptz
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
    actor_id bigint NOT NULL REFERENCES members(id),
    action text NOT NULL CHECK (action IN ('used', 'charged', 'stored', 'damaged', 'retired')),
    note text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS battery_events_code_idx ON battery_events(code, id DESC);
