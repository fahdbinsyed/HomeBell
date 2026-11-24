using System;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeBell.Modules.Schools.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class StudentsAndImports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "import_job",
                schema: "schools",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    file_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    committed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    failure_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    summary_json = table.Column<string>(type: "jsonb", nullable: false),
                    rows_json = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_import_job", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "school_class",
                schema: "schools",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    grade_level = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_school_class", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "section",
                schema: "schools",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    class_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_section", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "student",
                schema: "schools",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    external_ref = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    first_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    last_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    preferred_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    class_id = table.Column<Guid>(type: "uuid", nullable: false),
                    section_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    dismissal_eligibility = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    restrictions_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_student", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "tenant_settings",
                schema: "schools",
                columns: table => new
                {
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    json = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tenant_settings", x => x.tenant_id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_import_job_tenant_id_created_at",
                schema: "schools",
                table: "import_job",
                columns: new[] { "tenant_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_school_class_tenant_id_name",
                schema: "schools",
                table: "school_class",
                columns: new[] { "tenant_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_section_tenant_id_class_id_name",
                schema: "schools",
                table: "section",
                columns: new[] { "tenant_id", "class_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_student_tenant_id_class_id",
                schema: "schools",
                table: "student",
                columns: new[] { "tenant_id", "class_id" });

            migrationBuilder.CreateIndex(
                name: "ix_student_tenant_id_external_ref",
                schema: "schools",
                table: "student",
                columns: new[] { "tenant_id", "external_ref" },
                unique: true,
                filter: "external_ref IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_student_tenant_id_last_name_first_name",
                schema: "schools",
                table: "student",
                columns: new[] { "tenant_id", "last_name", "first_name" });

            // RLS (02-multitenancy §4.5)
            migrationBuilder.EnableTenantRls("schools", "school_class");
            migrationBuilder.EnableTenantRls("schools", "section");
            migrationBuilder.EnableTenantRls("schools", "student");
            migrationBuilder.EnableTenantRls("schools", "tenant_settings");
            migrationBuilder.EnableTenantRls("schools", "import_job");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "import_job",
                schema: "schools");

            migrationBuilder.DropTable(
                name: "school_class",
                schema: "schools");

            migrationBuilder.DropTable(
                name: "section",
                schema: "schools");

            migrationBuilder.DropTable(
                name: "student",
                schema: "schools");

            migrationBuilder.DropTable(
                name: "tenant_settings",
                schema: "schools");
        }
    }
}
