using System;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeBell.Modules.Guardians.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "guardians");

            migrationBuilder.CreateTable(
                name: "guardian",
                schema: "guardians",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    full_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    phone = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    state = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    activated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    valid_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    blocked_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_guardian", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_guardian_tenant_id_phone",
                schema: "guardians",
                table: "guardian",
                columns: new[] { "tenant_id", "phone" });

            migrationBuilder.CreateIndex(
                name: "ix_guardian_tenant_id_user_id",
                schema: "guardians",
                table: "guardian",
                columns: new[] { "tenant_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_guardian_user_id",
                schema: "guardians",
                table: "guardian",
                column: "user_id");

            // RLS (02-multitenancy §4.5): tenant-owned rows are visible only inside the request tenant.
            migrationBuilder.EnableTenantRls("guardians", "guardian");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "guardian",
                schema: "guardians");
        }
    }
}
