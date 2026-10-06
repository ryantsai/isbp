-- The audit trail is append-only: reject UPDATE, DELETE and TRUNCATE at the database level so that
-- neither application bugs nor ad-hoc SQL can rewrite history. Retention (Phase 1+) is done by
-- detaching monthly partitions, not by deleting rows.
CREATE OR REPLACE FUNCTION core.audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'core.audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON core.audit_logs
  FOR EACH ROW EXECUTE FUNCTION core.audit_logs_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON core.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_logs_immutable();
--> statement-breakpoint
-- Wake the outbox relay as soon as an event commits (NOTIFY is delivered on commit).
CREATE OR REPLACE FUNCTION core.outbox_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('isbp_outbox', NEW.seq::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_notify
  AFTER INSERT ON core.outbox_events
  FOR EACH ROW EXECUTE FUNCTION core.outbox_notify();
