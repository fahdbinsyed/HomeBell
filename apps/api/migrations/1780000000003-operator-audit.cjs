exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE control.audit_events ALTER COLUMN actor_id DROP NOT NULL;
    ALTER TABLE control.audit_events ADD COLUMN actor_type text NOT NULL DEFAULT 'user' CHECK(actor_type IN ('user','database_operator'));
    ALTER TABLE control.audit_events ADD COLUMN operator_name text;
    ALTER TABLE control.audit_events ADD CONSTRAINT explicit_actor CHECK ((actor_type='user' AND actor_id IS NOT NULL AND operator_name IS NULL) OR (actor_type='database_operator' AND actor_id IS NULL AND operator_name IS NOT NULL));`);
};
exports.down = () => {
  throw new Error("Forward repair only.");
};
