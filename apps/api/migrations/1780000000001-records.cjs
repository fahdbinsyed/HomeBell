exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app.classes (tenant_id uuid NOT NULL REFERENCES control.tenants(id), id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80), version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id));
    CREATE TABLE app.sections (tenant_id uuid NOT NULL, id uuid NOT NULL, class_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80), version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,class_id,id), FOREIGN KEY(tenant_id,class_id) REFERENCES app.classes(tenant_id,id));
    CREATE TABLE app.students (tenant_id uuid NOT NULL, id uuid NOT NULL, display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120), class_id uuid NOT NULL, section_id uuid, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,class_id) REFERENCES app.classes(tenant_id,id), FOREIGN KEY(tenant_id,class_id,section_id) REFERENCES app.sections(tenant_id,class_id,id));
    CREATE TABLE app.guardians (tenant_id uuid NOT NULL REFERENCES control.tenants(id), id uuid NOT NULL, user_id uuid REFERENCES identity.users(id), full_name text NOT NULL CHECK(length(full_name) BETWEEN 1 AND 120), phone text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked','deactivated')), version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id));
    CREATE TABLE app.guardian_links (tenant_id uuid NOT NULL, id uuid NOT NULL, student_id uuid NOT NULL, guardian_id uuid NOT NULL, role text NOT NULL CHECK(role IN ('primary','additional')), relationship text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked','deactivated','revoked')), valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,student_id) REFERENCES app.students(tenant_id,id), FOREIGN KEY(tenant_id,guardian_id) REFERENCES app.guardians(tenant_id,id));
    CREATE UNIQUE INDEX one_primary_link ON app.guardian_links(tenant_id,student_id) WHERE role='primary' AND status IN ('active','blocked','deactivated');
    CREATE UNIQUE INDEX unique_current_link ON app.guardian_links(tenant_id,student_id,guardian_id) WHERE status <> 'revoked';
    CREATE INDEX guardians_user ON app.guardians(tenant_id,user_id);
  `);
  for (const table of [
    "classes",
    "sections",
    "students",
    "guardians",
    "guardian_links",
  ]) {
    pgm.sql(`ALTER TABLE app.${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE app.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_scope ON app.${table} TO hb_tenant USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
      GRANT SELECT,INSERT,UPDATE ON app.${table} TO hb_tenant; CREATE INDEX ${table}_page ON app.${table}(tenant_id,id);`);
  }
};
exports.down = () => {
  throw new Error("Forward repair only.");
};
