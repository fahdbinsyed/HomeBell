using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeBell.Modules.Platform.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PlatformCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<DateOnly>(
                name: "term_start",
                schema: "platform",
                table: "tenant",
                type: "date",
                nullable: false,
                defaultValue: new DateOnly(1, 1, 1),
                oldClrType: typeof(DateOnly),
                oldType: "date",
                oldNullable: true);

            migrationBuilder.AlterColumn<DateOnly>(
                name: "term_end",
                schema: "platform",
                table: "tenant",
                type: "date",
                nullable: false,
                defaultValue: new DateOnly(1, 1, 1),
                oldClrType: typeof(DateOnly),
                oldType: "date",
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "contact_email",
                schema: "platform",
                table: "tenant",
                type: "character varying(254)",
                maxLength: 254,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "contact_name",
                schema: "platform",
                table: "tenant",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "contact_phone",
                schema: "platform",
                table: "tenant",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "last_activity_at",
                schema: "platform",
                table: "tenant",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "updated_at",
                schema: "platform",
                table: "tenant",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.CreateTable(
                name: "entitlement_override",
                schema: "platform",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    value_json = table.Column<string>(type: "jsonb", nullable: false),
                    reason_code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_by_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_by_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    revoked_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    revoked_by_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    revoke_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_entitlement_override", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "feature_flag",
                schema: "platform",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    enabled_by_default = table.Column<bool>(type: "boolean", nullable: false),
                    tenant_allow_list = table.Column<List<Guid>>(type: "uuid[]", nullable: false),
                    tenant_deny_list = table.Column<List<Guid>>(type: "uuid[]", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_feature_flag", x => x.key);
                });

            migrationBuilder.CreateTable(
                name: "plan_version",
                schema: "platform",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    price_minor = table.Column<long>(type: "bigint", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    billing_period = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    features = table.Column<string>(type: "jsonb", nullable: false),
                    limits = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    published_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_plan_version", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "subscription_plan",
                schema: "platform",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    is_public = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscription_plan", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "support_note",
                schema: "platform",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    category = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    body = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: false),
                    refund_status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    pinned = table.Column<bool>(type: "boolean", nullable: false),
                    author_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    author_id = table.Column<Guid>(type: "uuid", nullable: true),
                    author_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_support_note", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "support_session",
                schema: "platform",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    platform_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    platform_user_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    identity_session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_support_session", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "tenant_lifecycle_history",
                schema: "platform",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    from_state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    to_state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    reason_code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    refund_status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    actor_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    actor_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tenant_lifecycle_history", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "tenant_subscription",
                schema: "platform",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    billing_reference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_by_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tenant_subscription", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_entitlement_override_tenant_id",
                schema: "platform",
                table: "entitlement_override",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_plan_version_plan_id_version",
                schema: "platform",
                table: "plan_version",
                columns: new[] { "plan_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_subscription_plan_code",
                schema: "platform",
                table: "subscription_plan",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_support_note_tenant_id_created_at",
                schema: "platform",
                table: "support_note",
                columns: new[] { "tenant_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_support_session_tenant_id_started_at",
                schema: "platform",
                table: "support_session",
                columns: new[] { "tenant_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_tenant_lifecycle_history_tenant_id_at",
                schema: "platform",
                table: "tenant_lifecycle_history",
                columns: new[] { "tenant_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_tenant_subscription_tenant_id",
                schema: "platform",
                table: "tenant_subscription",
                column: "tenant_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "entitlement_override",
                schema: "platform");

            migrationBuilder.DropTable(
                name: "feature_flag",
                schema: "platform");

            migrationBuilder.DropTable(
                name: "plan_version",
                schema: "platform");

            migrationBuilder.DropTable(
                name: "subscription_plan",
                schema: "platform");

            migrationBuilder.DropTable(
                name: "support_note",
                schema: "platform");

            migrationBuilder.DropTable(
                name: "support_session",
                schema: "platform");

            migrationBuilder.DropTable(
                name: "tenant_lifecycle_history",
                schema: "platform");

            migrationBuilder.DropTable(
                name: "tenant_subscription",
                schema: "platform");

            migrationBuilder.DropColumn(
                name: "contact_email",
                schema: "platform",
                table: "tenant");

            migrationBuilder.DropColumn(
                name: "contact_name",
                schema: "platform",
                table: "tenant");

            migrationBuilder.DropColumn(
                name: "contact_phone",
                schema: "platform",
                table: "tenant");

            migrationBuilder.DropColumn(
                name: "last_activity_at",
                schema: "platform",
                table: "tenant");

            migrationBuilder.DropColumn(
                name: "updated_at",
                schema: "platform",
                table: "tenant");

            migrationBuilder.AlterColumn<DateOnly>(
                name: "term_start",
                schema: "platform",
                table: "tenant",
                type: "date",
                nullable: true,
                oldClrType: typeof(DateOnly),
                oldType: "date");

            migrationBuilder.AlterColumn<DateOnly>(
                name: "term_end",
                schema: "platform",
                table: "tenant",
                type: "date",
                nullable: true,
                oldClrType: typeof(DateOnly),
                oldType: "date");
        }
    }
}
