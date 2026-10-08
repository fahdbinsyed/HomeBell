exports.up = (pgm) => {
  pgm.sql(`
    SET LOCAL lock_timeout='5s';
    SET LOCAL statement_timeout='30s';
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM control.tenants WHERE status='active_paid') THEN
        RAISE EXCEPTION 'Reconcile Phase 1 paid assignments before migration; commercial history is required';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hb_counter') THEN
        CREATE ROLE hb_counter NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
    CREATE TABLE identity.platform_roles(name text PRIMARY KEY);
    CREATE TABLE identity.platform_role_permissions(role text REFERENCES identity.platform_roles(name),permission text NOT NULL,PRIMARY KEY(role,permission));
    CREATE TABLE identity.platform_role_assignments(user_id uuid REFERENCES identity.users(id),role text REFERENCES identity.platform_roles(name),PRIMARY KEY(user_id,role));
    GRANT SELECT ON identity.platform_roles,identity.platform_role_permissions,identity.platform_role_assignments TO hb_identity,hb_control;
    CREATE VIEW identity.effective_platform_permissions AS
      SELECT user_id,permission FROM identity.platform_permissions UNION
      SELECT a.user_id,p.permission FROM identity.platform_role_assignments a JOIN identity.platform_role_permissions p ON p.role=a.role;
    GRANT SELECT ON identity.effective_platform_permissions TO hb_identity,hb_control;
    INSERT INTO identity.platform_roles VALUES('Super Admin'),('Platform Operations'),('Billing Operations'),('Support Analyst');
    INSERT INTO identity.platform_role_permissions SELECT 'Super Admin',unnest(ARRAY['tenant.read','tenant.create','tenant.lifecycle','plan.read','plan.manage','access.manage','notes.read','notes.write','audit.all']);
    INSERT INTO identity.platform_role_permissions SELECT 'Platform Operations',unnest(ARRAY['tenant.read','tenant.create','tenant.lifecycle','plan.read','notes.read','notes.write','audit.operations']);
    INSERT INTO identity.platform_role_permissions SELECT 'Billing Operations',unnest(ARRAY['tenant.read','plan.read','plan.manage','access.manage','notes.read','notes.write','audit.billing']);
    INSERT INTO identity.platform_role_permissions SELECT 'Support Analyst',unnest(ARRAY['tenant.read','notes.read','audit.support']);
    CREATE TABLE control.plans(id uuid PRIMARY KEY,name text NOT NULL,code text UNIQUE NOT NULL,archived boolean NOT NULL DEFAULT false,version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE control.plan_versions(id uuid PRIMARY KEY,plan_id uuid NOT NULL REFERENCES control.plans(id),number int NOT NULL,amount_minor int NOT NULL CHECK(amount_minor>=0),currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),child_cap int NOT NULL CHECK(child_cap>=0),capabilities text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(plan_id,number));
    CREATE TABLE control.subscriptions(tenant_id uuid NOT NULL REFERENCES control.tenants(id),id uuid NOT NULL,plan_version_id uuid NOT NULL REFERENCES control.plan_versions(id),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,manual_reference text NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES identity.users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id),CHECK(ends_at>starts_at));
    CREATE TABLE control.access_grants(tenant_id uuid NOT NULL REFERENCES control.tenants(id),id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('trial','pilot_free','manual_override','active_paid','legacy')),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,child_cap int NOT NULL CHECK(child_cap>=0),capabilities text[] NOT NULL,subscription_id uuid,provenance text NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,subscription_id) REFERENCES control.subscriptions(tenant_id,id),CHECK(ends_at>starts_at));
    CREATE TABLE control.entitlement_overrides(tenant_id uuid NOT NULL REFERENCES control.tenants(id),id uuid NOT NULL,target text NOT NULL,bool_value boolean,int_value int CHECK(int_value>=0),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,revoked_at timestamptz,PRIMARY KEY(tenant_id,id),CHECK(ends_at>starts_at),CHECK((target='childCap' AND int_value IS NOT NULL AND bool_value IS NULL) OR (target<>'childCap' AND bool_value IS NOT NULL AND int_value IS NULL)));
    CREATE TABLE control.tenant_notes(tenant_id uuid NOT NULL REFERENCES control.tenants(id),id uuid NOT NULL,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),refund_status text CHECK(refund_status IN ('requested','reviewing','manually_recorded','declined')),actor_id uuid NOT NULL REFERENCES identity.users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id));
    CREATE TABLE control.lifecycle_history(tenant_id uuid NOT NULL REFERENCES control.tenants(id),id uuid NOT NULL,previous_status text NOT NULL,status text NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES identity.users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id));
    CREATE TABLE control.tenant_usage(tenant_id uuid PRIMARY KEY REFERENCES control.tenants(id),total_students int NOT NULL DEFAULT 0 CHECK(total_students>=0),active_students int NOT NULL DEFAULT 0 CHECK(active_students>=0),active_guardians int NOT NULL DEFAULT 0 CHECK(active_guardians>=0),blocked_guardians int NOT NULL DEFAULT 0 CHECK(blocked_guardians>=0),active_staff int NOT NULL DEFAULT 0 CHECK(active_staff>=0),observed_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO control.tenant_usage(tenant_id,total_students,active_students,active_guardians,blocked_guardians,active_staff)
      SELECT t.id,(SELECT count(*) FROM app.students WHERE tenant_id=t.id),(SELECT count(*) FROM app.students WHERE tenant_id=t.id AND status='active'),(SELECT count(*) FROM app.guardians WHERE tenant_id=t.id AND status='active'),(SELECT count(*) FROM app.guardians WHERE tenant_id=t.id AND status='blocked'),(SELECT count(*) FROM app.memberships WHERE tenant_id=t.id AND active) FROM control.tenants t;
    INSERT INTO control.access_grants(tenant_id,id,kind,starts_at,ends_at,child_cap,capabilities,provenance)
      SELECT t.id,gen_random_uuid(),'legacy',now(),t.access_until,u.active_students,ARRAY['tenant.read','school.records.read','school.records.write','guardians.read','guardians.manage','audit.read'],'phase1_migration' FROM control.tenants t JOIN control.tenant_usage u ON u.tenant_id=t.id WHERE t.status IN ('trial','pilot_free','manual_override') AND t.access_until>now();
    ALTER TABLE control.audit_events ADD COLUMN tenant_id uuid REFERENCES control.tenants(id), ADD COLUMN category text NOT NULL DEFAULT 'operations' CHECK(category IN ('operations','billing','support'));
    CREATE INDEX platform_audit_filter ON control.audit_events(category,created_at,tenant_id,id);
    GRANT UPDATE ON control.tenants TO hb_control;
    GRANT SELECT,INSERT,UPDATE ON control.plans TO hb_control;
    GRANT SELECT,INSERT ON control.plan_versions TO hb_control;
    GRANT USAGE ON SCHEMA control TO hb_counter;
    GRANT SELECT,INSERT,UPDATE ON control.tenant_usage TO hb_counter;
    GRANT SELECT,UPDATE ON control.tenant_usage TO hb_tenant;
    GRANT SELECT,INSERT ON control.tenant_usage TO hb_control;
  `);
  for (const table of ['subscriptions','access_grants','entitlement_overrides','tenant_notes','lifecycle_history','tenant_usage']) {
    pgm.sql(`ALTER TABLE control.${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE control.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY control_access ON control.${table} TO hb_control USING(true) WITH CHECK(true);
      CREATE INDEX ${table}_tenant ON control.${table}(tenant_id);`);
    if (table !== 'tenant_usage') pgm.sql(`GRANT SELECT,INSERT ON control.${table} TO hb_control;`);
    if (['access_grants','entitlement_overrides','tenant_usage'].includes(table)) pgm.sql(`GRANT SELECT ON control.${table} TO hb_tenant; CREATE POLICY school_scope ON control.${table} FOR SELECT TO hb_tenant USING(tenant_id::text=current_setting('app.tenant_id',true));`);
  }
  pgm.sql(`
    GRANT UPDATE(ends_at) ON control.access_grants TO hb_control;
    GRANT UPDATE(revoked_at) ON control.entitlement_overrides TO hb_control;
    REVOKE UPDATE ON control.tenant_usage FROM hb_tenant;
    GRANT UPDATE(tenant_id) ON control.tenant_usage TO hb_tenant;
    CREATE POLICY counter_access ON control.tenant_usage TO hb_counter USING(true) WITH CHECK(true);
    CREATE FUNCTION control.update_usage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE t uuid; old_active int:=0; new_active int:=0; old_blocked int:=0; new_blocked int:=0; delta int:=0;
    BEGIN
      t:=COALESCE(NEW.tenant_id,OLD.tenant_id);
      IF TG_OP='UPDATE' AND NEW.tenant_id<>OLD.tenant_id THEN RAISE EXCEPTION 'Tenant movement forbidden'; END IF;
      IF TG_OP='INSERT' THEN delta:=1; ELSIF TG_OP='DELETE' THEN delta:=-1; END IF;
      IF TG_TABLE_NAME='memberships' THEN
        IF TG_OP<>'INSERT' AND OLD.active THEN old_active:=1; END IF;
        IF TG_OP<>'DELETE' AND NEW.active THEN new_active:=1; END IF;
      ELSE
        IF TG_OP<>'INSERT' THEN old_active:=(OLD.status='active')::int; old_blocked:=(OLD.status='blocked')::int; END IF;
        IF TG_OP<>'DELETE' THEN new_active:=(NEW.status='active')::int; new_blocked:=(NEW.status='blocked')::int; END IF;
      END IF;
      INSERT INTO control.tenant_usage(tenant_id) VALUES(t) ON CONFLICT DO NOTHING;
      UPDATE control.tenant_usage SET
        total_students=total_students+CASE WHEN TG_TABLE_NAME='students' THEN delta ELSE 0 END,
        active_students=active_students+CASE WHEN TG_TABLE_NAME='students' THEN new_active-old_active ELSE 0 END,
        active_guardians=active_guardians+CASE WHEN TG_TABLE_NAME='guardians' THEN new_active-old_active ELSE 0 END,
        blocked_guardians=blocked_guardians+CASE WHEN TG_TABLE_NAME='guardians' THEN new_blocked-old_blocked ELSE 0 END,
        active_staff=active_staff+CASE WHEN TG_TABLE_NAME='memberships' THEN new_active-old_active ELSE 0 END,observed_at=clock_timestamp() WHERE tenant_id=t;
      RETURN COALESCE(NEW,OLD);
    END $$;
    ALTER FUNCTION control.update_usage() OWNER TO hb_counter;
    REVOKE ALL ON FUNCTION control.update_usage() FROM PUBLIC;
    CREATE TRIGGER students_usage AFTER INSERT OR UPDATE OR DELETE ON app.students FOR EACH ROW EXECUTE FUNCTION control.update_usage();
    CREATE TRIGGER guardians_usage AFTER INSERT OR UPDATE OR DELETE ON app.guardians FOR EACH ROW EXECUTE FUNCTION control.update_usage();
    CREATE TRIGGER staff_usage AFTER INSERT OR UPDATE OR DELETE ON app.memberships FOR EACH ROW EXECUTE FUNCTION control.update_usage();
  `);
};
exports.down = () => { throw new Error('Forward repair only: reverting enforcement would bypass access restrictions.'); };
