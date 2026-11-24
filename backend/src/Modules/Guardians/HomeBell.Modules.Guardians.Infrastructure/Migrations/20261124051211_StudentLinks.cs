using System;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeBell.Modules.Guardians.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class StudentLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "blocked_reason",
                schema: "guardians",
                table: "guardian",
                newName: "state_reason");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "last_active_at",
                schema: "guardians",
                table: "guardian",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "last_welcome_sent_at",
                schema: "guardians",
                table: "guardian",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "state_changed_at",
                schema: "guardians",
                table: "guardian",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "updated_at",
                schema: "guardians",
                table: "guardian",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.CreateTable(
                name: "guardian_student_link",
                schema: "guardians",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    guardian_id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    relationship = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    is_primary = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    removed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_guardian_student_link", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_guardian_student_link_tenant_id_guardian_id",
                schema: "guardians",
                table: "guardian_student_link",
                columns: new[] { "tenant_id", "guardian_id" });

            migrationBuilder.CreateIndex(
                name: "ix_guardian_student_link_tenant_id_student_id",
                schema: "guardians",
                table: "guardian_student_link",
                columns: new[] { "tenant_id", "student_id" });

            migrationBuilder.CreateIndex(
                name: "ix_guardian_student_link_tenant_id_student_id1",
                schema: "guardians",
                table: "guardian_student_link",
                columns: new[] { "tenant_id", "student_id" },
                unique: true,
                filter: "is_primary AND removed_at IS NULL");

            // RLS (02-multitenancy §4.5)
            migrationBuilder.EnableTenantRls("guardians", "guardian_student_link");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "guardian_student_link",
                schema: "guardians");

            migrationBuilder.DropColumn(
                name: "last_active_at",
                schema: "guardians",
                table: "guardian");

            migrationBuilder.DropColumn(
                name: "last_welcome_sent_at",
                schema: "guardians",
                table: "guardian");

            migrationBuilder.DropColumn(
                name: "state_changed_at",
                schema: "guardians",
                table: "guardian");

            migrationBuilder.DropColumn(
                name: "updated_at",
                schema: "guardians",
                table: "guardian");

            migrationBuilder.RenameColumn(
                name: "state_reason",
                schema: "guardians",
                table: "guardian",
                newName: "blocked_reason");
        }
    }
}
