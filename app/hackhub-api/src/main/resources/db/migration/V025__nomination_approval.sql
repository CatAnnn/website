-- NULL preserves publication of nominations created before HoD approval was introduced.
ALTER TABLE ideas ADD COLUMN approval_status varchar(16),
    ADD COLUMN approval_head_key varchar(255),
    ADD COLUMN approval_head_name varchar(255),
    ADD COLUMN approval_reason text,
    ADD COLUMN approval_reviewed_at timestamptz,
    ADD COLUMN approval_reviewer_name varchar(255),
    ADD COLUMN approval_version integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT ideas_approval_status_check CHECK (approval_status IN ('pending', 'approved', 'rejected'));
CREATE INDEX idx_ideas_approval_head ON ideas(approval_head_key, created_at DESC) WHERE approval_status IS NOT NULL;
CREATE INDEX idx_ideas_creator ON ideas(created_by, created_at DESC);
CREATE TABLE nomination_approval_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
    submission_version integer NOT NULL,
    decision varchar(16) NOT NULL CHECK (decision IN ('submitted', 'approved', 'rejected')),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sso_identities ADD COLUMN verified_email varchar(255);
