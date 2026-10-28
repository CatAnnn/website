-- Account deletion must not cascade through shared awards, nominations or votes.
ALTER TABLE organizations
    DROP CONSTRAINT organizations_created_by_fkey,
    ADD CONSTRAINT organizations_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE hackathons
    DROP CONSTRAINT hackathons_created_by_fkey,
    ADD CONSTRAINT hackathons_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE teams
    DROP CONSTRAINT teams_created_by_fkey,
    ADD CONSTRAINT teams_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE ideas
    DROP CONSTRAINT ideas_created_by_fkey,
    ADD CONSTRAINT ideas_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE final_submissions
    DROP CONSTRAINT final_submissions_submitted_by_fkey,
    ADD CONSTRAINT final_submissions_submitted_by_fkey
        FOREIGN KEY (submitted_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE idea_votes
    DROP CONSTRAINT idea_votes_user_id_fkey,
    ADD CONSTRAINT idea_votes_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE idea_scores
    DROP CONSTRAINT idea_scores_user_id_fkey,
    ADD CONSTRAINT idea_scores_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE judge_scores
    DROP CONSTRAINT judge_scores_judge_id_fkey,
    ADD CONSTRAINT judge_scores_judge_id_fkey
        FOREIGN KEY (judge_id) REFERENCES profiles(id) ON DELETE RESTRICT;

-- Nominees are also referenced in JSON attachments, without a foreign key.
CREATE FUNCTION protect_nominated_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM ideas WHERE project_attachments @>
        jsonb_build_array(jsonb_build_object('type', 'nomination', 'nomineeUserId', OLD.id::text))) THEN
        RAISE EXCEPTION 'Account is referenced by a nomination; preserve award history'
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER protect_nominated_profile_before_delete
    BEFORE DELETE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_nominated_profile();
