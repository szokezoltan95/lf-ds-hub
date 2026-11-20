-- Equipment beyond batteries and the shared teams/lineups permission.
CREATE TABLE IF NOT EXISTS equipment_assets (
    code text PRIMARY KEY CHECK (code ~ '^LF-(C|D|X)[0-9]{2,6}$'),
    kind text NOT NULL CHECK (kind IN ('controller','drone','charger')),
    label text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS equipment_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL REFERENCES equipment_assets(code) ON DELETE CASCADE,
    actor_id bigint REFERENCES members(id) ON DELETE SET NULL,
    action text NOT NULL CHECK (action IN (
        'assigned','returned','inspection','training','fault','repair','maintenance',
        'propeller_replacement','motor_replacement','battery_check','retired','note'
    )),
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE equipment_events ADD COLUMN IF NOT EXISTS member_id bigint REFERENCES members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS equipment_events_code_idx ON equipment_events(code,id DESC);
CREATE INDEX IF NOT EXISTS equipment_events_created_at_idx ON equipment_events(created_at);

UPDATE role_menu_permissions AS destination SET
    access_level = CASE
        WHEN source.access_level='edit' OR destination.access_level='edit' THEN 'edit'
        WHEN source.access_level='read' OR destination.access_level='read' THEN 'read'
        ELSE 'none' END,
    enabled = source.enabled OR destination.enabled
FROM role_menu_permissions AS source
WHERE destination.role_key=source.role_key AND destination.menu_key='team' AND source.menu_key='lineups';
UPDATE role_menu_permissions SET menu_key='team'
WHERE menu_key='lineups' AND NOT EXISTS (
    SELECT 1 FROM role_menu_permissions target WHERE target.role_key=role_menu_permissions.role_key AND target.menu_key='team'
);
DELETE FROM role_menu_permissions WHERE menu_key='lineups';
