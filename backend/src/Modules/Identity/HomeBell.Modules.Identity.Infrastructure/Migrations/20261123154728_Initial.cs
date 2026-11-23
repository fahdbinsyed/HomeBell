using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeBell.Modules.Identity.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "identity");

            migrationBuilder.CreateTable(
                name: "device_registration",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    install_id = table.Column<Guid>(type: "uuid", nullable: false),
                    platform = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    model = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    os_version = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    app_version = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    state = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    activated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_device_registration", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "mfa_factor",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    protected_secret = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    confirmed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_used_time_step = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_mfa_factor", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "otp_challenge",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    phone = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    phone_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    purpose = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    died_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    device_install_id = table.Column<Guid>(type: "uuid", nullable: true),
                    invitation_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_otp_challenge", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "otp_send_log",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    phone_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    country_code = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false),
                    purpose = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ip_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    device_install_id = table.Column<Guid>(type: "uuid", nullable: true),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_otp_send_log", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "password_reset_token",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_password_reset_token", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "platform_role_assignment",
                schema: "identity",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_platform_role_assignment", x => new { x.user_id, x.role });
                });

            migrationBuilder.CreateTable(
                name: "recovery_code",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_recovery_code", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "refresh_token",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    rotated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_refresh_token", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "session",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    scope = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    device_id = table.Column<Guid>(type: "uuid", nullable: true),
                    support_tenant_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    absolute_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    sliding_seconds = table.Column<int>(type: "integer", nullable: true),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoke_reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_session", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "staff_credential",
                schema: "identity",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    password_hash = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    changed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_staff_credential", x => x.user_id);
                });

            migrationBuilder.CreateTable(
                name: "user_account",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    full_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    phone = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    locale = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    is_deactivated = table.Column<bool>(type: "boolean", nullable: false),
                    failed_login_count = table.Column<int>(type: "integer", nullable: false),
                    locked_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    terms_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    terms_accepted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_login_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_account", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_device_registration_user_id",
                schema: "identity",
                table: "device_registration",
                column: "user_id",
                unique: true,
                filter: "state = 'active'");

            migrationBuilder.CreateIndex(
                name: "ix_device_registration_user_id_install_id",
                schema: "identity",
                table: "device_registration",
                columns: new[] { "user_id", "install_id" });

            migrationBuilder.CreateIndex(
                name: "ix_mfa_factor_user_id",
                schema: "identity",
                table: "mfa_factor",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_otp_challenge_phone_hash_created_at",
                schema: "identity",
                table: "otp_challenge",
                columns: new[] { "phone_hash", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_otp_send_log_at",
                schema: "identity",
                table: "otp_send_log",
                column: "at");

            migrationBuilder.CreateIndex(
                name: "ix_otp_send_log_device_install_id_at",
                schema: "identity",
                table: "otp_send_log",
                columns: new[] { "device_install_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_otp_send_log_ip_hash_at",
                schema: "identity",
                table: "otp_send_log",
                columns: new[] { "ip_hash", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_otp_send_log_phone_hash_at",
                schema: "identity",
                table: "otp_send_log",
                columns: new[] { "phone_hash", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_password_reset_token_token_hash",
                schema: "identity",
                table: "password_reset_token",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_recovery_code_user_id",
                schema: "identity",
                table: "recovery_code",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_refresh_token_session_id",
                schema: "identity",
                table: "refresh_token",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "ix_refresh_token_token_hash",
                schema: "identity",
                table: "refresh_token",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_session_device_id",
                schema: "identity",
                table: "session",
                column: "device_id");

            migrationBuilder.CreateIndex(
                name: "ix_session_user_id",
                schema: "identity",
                table: "session",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_account_email",
                schema: "identity",
                table: "user_account",
                column: "email",
                unique: true,
                filter: "email IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_user_account_phone",
                schema: "identity",
                table: "user_account",
                column: "phone",
                unique: true,
                filter: "phone IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "device_registration",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "mfa_factor",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "otp_challenge",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "otp_send_log",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "password_reset_token",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "platform_role_assignment",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "recovery_code",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "refresh_token",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "session",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "staff_credential",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "user_account",
                schema: "identity");
        }
    }
}
