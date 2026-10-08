exports.up = pgm => pgm.sql(`
  CREATE POLICY allocation_lock ON control.tenant_usage FOR UPDATE TO hb_tenant
  USING(tenant_id::text=current_setting('app.tenant_id',true))
  WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
`);
exports.down = () => { throw new Error('Forward repair only.'); };
