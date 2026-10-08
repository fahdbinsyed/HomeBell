exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app.audit_events (tenant_id uuid NOT NULL REFERENCES control.tenants(id), id uuid NOT NULL, actor_id uuid NOT NULL, action text NOT NULL, resource_id uuid NOT NULL, request_id uuid NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id));
    CREATE TABLE app.idempotency (tenant_id uuid NOT NULL REFERENCES control.tenants(id), actor_id uuid NOT NULL, operation text NOT NULL, key text NOT NULL, digest text NOT NULL, result jsonb, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', PRIMARY KEY(tenant_id,actor_id,operation,key));
    CREATE TABLE app.outbox (tenant_id uuid NOT NULL REFERENCES control.tenants(id), id uuid NOT NULL, type text NOT NULL, resource_id uuid NOT NULL, request_id uuid NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, PRIMARY KEY(tenant_id,id));
    CREATE TABLE control.audit_events (id uuid PRIMARY KEY, actor_id uuid NOT NULL, action text NOT NULL, resource_id uuid NOT NULL, request_id uuid NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE control.idempotency (actor_id uuid NOT NULL, operation text NOT NULL, key text NOT NULL, digest text NOT NULL, result jsonb, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', PRIMARY KEY(actor_id,operation,key));
    CREATE INDEX audit_tenant_time ON app.audit_events(tenant_id,created_at,id);
    CREATE INDEX outbox_pending ON app.outbox(created_at) WHERE published_at IS NULL;
    GRANT SELECT,INSERT ON control.audit_events TO hb_control;
    GRANT SELECT,INSERT,UPDATE ON control.idempotency TO hb_control;
  `);
  for (const table of ["audit_events", "idempotency", "outbox"]) {
    pgm.sql(`ALTER TABLE app.${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE app.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_scope ON app.${table} TO hb_tenant,hb_control USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
      GRANT SELECT,INSERT ON app.${table} TO hb_tenant,hb_control;`);
  }
  pgm.sql("GRANT UPDATE ON app.idempotency TO hb_tenant;");
};
exports.down = () => {
  throw new Error("Forward repair only.");
};
