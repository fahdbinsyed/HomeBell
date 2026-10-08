exports.up = (pgm) => {
  pgm.sql(`
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    CREATE SCHEMA identity;
    CREATE SCHEMA app;
    CREATE SCHEMA control;
    CREATE TABLE control.tenants (
      id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), time_zone text NOT NULL,
      status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','trial','pilot_free','active_paid','manual_override','suspended','deactivated','cancelled','offboarding','expired')),
      access_until timestamptz, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE identity.users (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')), security_version int NOT NULL DEFAULT 1, active_device_id uuid, last_transfer_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE identity.external_identities (issuer text NOT NULL, subject text NOT NULL, user_id uuid NOT NULL REFERENCES identity.users(id), PRIMARY KEY(issuer,subject));
    CREATE TABLE identity.devices (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES identity.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id));
    ALTER TABLE identity.users ADD CONSTRAINT active_device_owner FOREIGN KEY(id,active_device_id) REFERENCES identity.devices(user_id,id);
    CREATE TABLE identity.sessions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES identity.users(id), audience text NOT NULL CHECK(audience IN ('school','platform','guardian')),
      security_version int NOT NULL, csrf_digest text NOT NULL, mfa boolean NOT NULL DEFAULT false, device_id uuid,
      expires_at timestamptz NOT NULL, idle_until timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(user_id,device_id) REFERENCES identity.devices(user_id,id)
    );
    CREATE INDEX sessions_user ON identity.sessions(user_id);
    CREATE TABLE identity.refresh_tokens (digest text PRIMARY KEY, session_id uuid NOT NULL REFERENCES identity.sessions(id), consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX refresh_session ON identity.refresh_tokens(session_id);
    CREATE TABLE identity.platform_permissions (user_id uuid NOT NULL REFERENCES identity.users(id), permission text NOT NULL, PRIMARY KEY(user_id,permission));
    CREATE TABLE identity.security_events (id uuid PRIMARY KEY, actor_id uuid, action text NOT NULL, request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE identity.otp_challenges (id uuid PRIMARY KEY, subject_digest text NOT NULL, purpose text NOT NULL, verifier text NOT NULL, attempts int NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), expires_at timestamptz NOT NULL, consumed_at timestamptz);
    CREATE TABLE identity.otp_proofs (digest text PRIMARY KEY, challenge_id uuid NOT NULL REFERENCES identity.otp_challenges(id), purpose text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz);
    CREATE TABLE app.campuses (tenant_id uuid NOT NULL REFERENCES control.tenants(id), id uuid NOT NULL, name text NOT NULL, PRIMARY KEY(tenant_id,id));
    CREATE TABLE app.roles (tenant_id uuid NOT NULL REFERENCES control.tenants(id), id uuid NOT NULL, name text NOT NULL, PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,name));
    CREATE TABLE app.role_permissions (tenant_id uuid NOT NULL, role_id uuid NOT NULL, permission text NOT NULL, PRIMARY KEY(tenant_id,role_id,permission), FOREIGN KEY(tenant_id,role_id) REFERENCES app.roles(tenant_id,id));
    CREATE TABLE app.memberships (tenant_id uuid NOT NULL REFERENCES control.tenants(id), user_id uuid NOT NULL REFERENCES identity.users(id), role_id uuid NOT NULL, active boolean NOT NULL DEFAULT true, PRIMARY KEY(tenant_id,user_id), FOREIGN KEY(tenant_id,role_id) REFERENCES app.roles(tenant_id,id));
    GRANT USAGE ON SCHEMA identity TO hb_identity,hb_tenant,hb_control;
    GRANT USAGE ON SCHEMA app,control TO hb_tenant,hb_control;
    GRANT USAGE ON SCHEMA app,control TO hb_identity;
    GRANT SELECT,INSERT,UPDATE ON identity.users,identity.devices,identity.sessions,identity.refresh_tokens,identity.otp_challenges,identity.otp_proofs TO hb_identity;
    GRANT SELECT ON identity.external_identities,identity.platform_permissions TO hb_identity;
    GRANT INSERT ON identity.security_events TO hb_identity;
    GRANT SELECT (id,status,security_version,active_device_id) ON identity.users TO hb_tenant,hb_control;
    GRANT SELECT (id,user_id,audience,security_version,csrf_digest,mfa,device_id,expires_at,idle_until,revoked_at) ON identity.sessions TO hb_tenant,hb_control;
    GRANT SELECT ON identity.platform_permissions TO hb_control;
    -- Row-level locks need UPDATE privilege, but never grant modification of security values.
    GRANT UPDATE (id) ON identity.users,identity.sessions TO hb_tenant,hb_control;
    GRANT SELECT,INSERT ON control.tenants TO hb_control;
    GRANT SELECT ON control.tenants TO hb_tenant,hb_identity;
    GRANT UPDATE (id) ON control.tenants TO hb_tenant;
    GRANT SELECT ON app.memberships,app.roles,app.role_permissions TO hb_tenant;
    GRANT UPDATE (user_id) ON app.memberships TO hb_tenant;
    GRANT SELECT,INSERT ON app.campuses,app.roles,app.role_permissions TO hb_control;
    GRANT SELECT ON app.campuses TO hb_tenant;
    ALTER TABLE control.tenants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE control.tenants FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_context ON control.tenants TO hb_tenant USING (id::text=current_setting('app.tenant_id',true));
    CREATE POLICY platform_catalog ON control.tenants TO hb_control USING (true) WITH CHECK (true);
    CREATE POLICY identity_catalog ON control.tenants FOR SELECT TO hb_identity USING (id IN (SELECT tenant_id FROM app.memberships WHERE user_id::text=current_setting('app.actor_id',true) AND active));
  `);
  for (const table of [
    "campuses",
    "roles",
    "role_permissions",
    "memberships",
  ]) {
    pgm.sql(`ALTER TABLE app.${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE app.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_scope ON app.${table} TO hb_tenant,hb_control USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));`);
  }
  pgm.sql(`GRANT SELECT ON app.memberships TO hb_identity;
    CREATE POLICY identity_membership ON app.memberships FOR SELECT TO hb_identity USING(user_id::text=current_setting('app.actor_id',true));`);
};
exports.down = () => {
  throw new Error(
    "Destructive rollback is not automatic; restore or apply a reviewed forward repair.",
  );
};
