using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeBell.Modules.Audit.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "audit");

            migrationBuilder.CreateTable(
                name: "audit_log",
                schema: "audit",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: true),
                    actor_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    actor_display = table.Column<string>(type: "text", nullable: false),
                    on_behalf_of = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    target_type = table.Column<string>(type: "text", nullable: true),
                    target_id = table.Column<string>(type: "text", nullable: true),
                    outcome = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    reason_code = table.Column<string>(type: "text", nullable: true),
                    ip_hash = table.Column<string>(type: "text", nullable: true),
                    user_agent = table.Column<string>(type: "text", nullable: true),
                    device_id = table.Column<Guid>(type: "uuid", nullable: true),
                    request_id = table.Column<string>(type: "text", nullable: true),
                    data = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_log", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_audit_log_occurred_at",
                schema: "audit",
                table: "audit_log",
                column: "occurred_at");

            migrationBuilder.CreateIndex(
                name: "ix_audit_log_tenant_id_occurred_at",
                schema: "audit",
                table: "audit_log",
                columns: new[] { "tenant_id", "occurred_at" });

            // RLS (02-multitenancy §4.5): tenant-owned rows are visible only inside the request tenant.
            // Audit: tenant rows readable only in their tenant (platform reads use the cross-tenant scope);
            // inserts always allowed (append-only; UPDATE/DELETE are not granted to the app role).
            migrationBuilder.Sql("ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("ALTER TABLE audit.audit_log FORCE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("CREATE POLICY audit_read ON audit.audit_log FOR SELECT USING (current_setting('app.cross_tenant', true) = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);");
            migrationBuilder.Sql("CREATE POLICY audit_insert ON audit.audit_log FOR INSERT WITH CHECK (true);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_log",
                schema: "audit");
        }
    }
}
