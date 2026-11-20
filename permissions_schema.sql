CREATE TABLE IF NOT EXISTS role_grants (
    role_key text NOT NULL REFERENCES role_catalog(role_key) ON DELETE CASCADE,
    permission text NOT NULL,
    PRIMARY KEY (role_key, permission)
);
CREATE TABLE IF NOT EXISTS role_grant_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id bigint REFERENCES members(id) ON DELETE SET NULL,
    role_key text NOT NULL,
    added text[] NOT NULL,
    removed text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS permission_previews (
    session_hash text PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
    roles text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS training_proposals (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL,
    location text NOT NULL,
    instructions text NOT NULL DEFAULT '',
    created_by bigint REFERENCES members(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    version integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','closed','withdrawn','rejected','approved')),
    decided_by bigint REFERENCES members(id) ON DELETE SET NULL,
    decided_at timestamptz,
    training_id bigint UNIQUE REFERENCES trainings(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS training_proposal_options (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proposal_id bigint NOT NULL REFERENCES training_proposals(id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    UNIQUE (proposal_id, starts_at),
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS training_proposal_votes (
    option_id bigint NOT NULL REFERENCES training_proposal_options(id) ON DELETE CASCADE,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    response text NOT NULL CHECK (response IN ('yes','no','maybe')),
    PRIMARY KEY (option_id, member_id)
);

CREATE TABLE IF NOT EXISTS equipment_loans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL REFERENCES equipment_assets(code),
    member_id bigint REFERENCES members(id) ON DELETE SET NULL,
    created_by bigint REFERENCES members(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    due_at timestamptz,
    accepted_at timestamptz,
    closed_by bigint REFERENCES members(id) ON DELETE SET NULL,
    closed_at timestamptz,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','returned','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_one_open_loan ON equipment_loans(code)
    WHERE status IN ('pending','accepted');

CREATE OR REPLACE VIEW equipment_current_assignment AS
SELECT DISTINCT ON (code) code, member_id, action
FROM equipment_events WHERE action IN ('assigned','returned','retired') ORDER BY code,id DESC;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS author_id bigint REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE training_workspace ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;
ALTER TABLE training_lineups ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS nomination_responses (
    training_id bigint NOT NULL REFERENCES training_lineups(training_id) ON DELETE CASCADE,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    accepted boolean NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(training_id,member_id)
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS requires_acknowledgement boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS document_acknowledgements (
    document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(document_id,member_id)
);
