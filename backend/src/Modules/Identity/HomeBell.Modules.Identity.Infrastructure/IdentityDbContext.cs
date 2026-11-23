using System.Security.Cryptography;
using System.Text;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.Modules.Identity.Application;
using HomeBell.Modules.Identity.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Hosting;

namespace HomeBell.Modules.Identity.Infrastructure;

/// <summary>Identity schema: global (not tenant-owned) accounts, credentials, sessions, devices and OTP.</summary>
public sealed class IdentityDbContext(DbContextOptions<IdentityDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "identity";

    public override string Schema => SchemaName;

    public DbSet<UserAccount> Users => Set<UserAccount>();

    public DbSet<StaffCredential> Credentials => Set<StaffCredential>();

    public DbSet<PlatformRoleAssignment> PlatformRoles => Set<PlatformRoleAssignment>();

    public DbSet<MfaFactor> MfaFactors => Set<MfaFactor>();

    public DbSet<RecoveryCode> RecoveryCodes => Set<RecoveryCode>();

    public DbSet<Session> Sessions => Set<Session>();

    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    public DbSet<DeviceRegistration> Devices => Set<DeviceRegistration>();

    public DbSet<OtpChallenge> OtpChallenges => Set<OtpChallenge>();

    public DbSet<OtpSendLog> OtpSends => Set<OtpSendLog>();

    public DbSet<PasswordResetToken> PasswordResets => Set<PasswordResetToken>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<UserAccount>(e =>
        {
            e.ToTable("user_account");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Email).IsUnique().HasFilter("email IS NOT NULL");
            e.HasIndex(x => x.Phone).IsUnique().HasFilter("phone IS NOT NULL");
            e.Property(x => x.FullName).HasMaxLength(120);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.Phone).HasMaxLength(16);
            e.Property(x => x.Locale).HasMaxLength(10);
            e.Property(x => x.TermsVersion).HasMaxLength(32);
            e.Property<uint>("xmin").IsRowVersion();
        });
        modelBuilder.Entity<StaffCredential>(e =>
        {
            e.ToTable("staff_credential");
            e.HasKey(x => x.UserId);
            e.Property(x => x.PasswordHash).HasMaxLength(512);
        });
        modelBuilder.Entity<PlatformRoleAssignment>(e =>
        {
            e.ToTable("platform_role_assignment");
            e.HasKey(x => new { x.UserId, x.Role });
            e.Property(x => x.Role).HasMaxLength(48);
        });
        modelBuilder.Entity<MfaFactor>(e =>
        {
            e.ToTable("mfa_factor");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.UserId);
            e.Property(x => x.ProtectedSecret).HasMaxLength(1024);
        });
        modelBuilder.Entity<RecoveryCode>(e =>
        {
            e.ToTable("recovery_code");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.UserId);
            e.Property(x => x.CodeHash).HasMaxLength(64);
        });
        modelBuilder.Entity<Session>(e =>
        {
            e.ToTable("session");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.UserId);
            e.HasIndex(x => x.DeviceId);
            e.Property(x => x.Kind).HasMaxLength(16);
            e.Property(x => x.Scope).HasMaxLength(32);
            e.Property(x => x.RevokeReason).HasMaxLength(32);
            e.Ignore(x => x.ExpiresAt);
        });
        modelBuilder.Entity<RefreshToken>(e =>
        {
            e.ToTable("refresh_token");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.SessionId);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.Property<uint>("xmin").IsRowVersion();
        });
        modelBuilder.Entity<DeviceRegistration>(e =>
        {
            e.ToTable("device_registration");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.InstallId });
            e.HasIndex(x => x.UserId).IsUnique().HasFilter("state = 'active'"); // one active device per account (ADR-0010)
            e.Property(x => x.Platform).HasMaxLength(16);
            e.Property(x => x.Model).HasMaxLength(100);
            e.Property(x => x.OsVersion).HasMaxLength(50);
            e.Property(x => x.AppVersion).HasMaxLength(50);
            e.Property(x => x.State).HasMaxLength(24);
        });
        modelBuilder.Entity<OtpChallenge>(e =>
        {
            e.ToTable("otp_challenge");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.PhoneHash, x.CreatedAt });
            e.Property(x => x.Phone).HasMaxLength(16);
            e.Property(x => x.PhoneHash).HasMaxLength(64);
            e.Property(x => x.Purpose).HasMaxLength(24);
            e.Property(x => x.CodeHash).HasMaxLength(64);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property<uint>("xmin").IsRowVersion();
        });
        modelBuilder.Entity<OtpSendLog>(e =>
        {
            e.ToTable("otp_send_log");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.PhoneHash, x.At });
            e.HasIndex(x => new { x.IpHash, x.At });
            e.HasIndex(x => new { x.DeviceInstallId, x.At });
            e.HasIndex(x => x.At);
            e.Property(x => x.PhoneHash).HasMaxLength(64);
            e.Property(x => x.CountryCode).HasMaxLength(5);
            e.Property(x => x.Purpose).HasMaxLength(24);
            e.Property(x => x.IpHash).HasMaxLength(64);
        });
        modelBuilder.Entity<PasswordResetToken>(e =>
        {
            e.ToTable("password_reset_token");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.Property(x => x.TokenHash).HasMaxLength(64);
        });
    }
}

/// <summary>Hashing and random-token helpers. Codes and tokens are only ever stored hashed.</summary>
public sealed class IdentityCrypto
{
    private readonly byte[] _key;

    public IdentityCrypto(OtpOptions options, IHostEnvironment env)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(env);
        if (!string.IsNullOrWhiteSpace(options.HashKey))
        {
            _key = Convert.FromBase64String(options.HashKey);
        }
        else if (env.IsDevelopment() || env.IsEnvironment("Testing"))
        {
            _key = RandomNumberGenerator.GetBytes(32);
        }
        else
        {
            throw new InvalidOperationException("Otp:HashKey must be configured outside Development.");
        }
    }

    /// <summary>Keyed hash (HMAC-SHA256) for OTP codes and phone numbers.</summary>
    public string Hmac(string purpose, string value) =>
        Convert.ToHexStringLower(HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes(purpose + ":" + value)));

    public static string Sha256(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>256-bit opaque token, base64url.</summary>
    public static string NewToken() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string NewOtpCode() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);

    public static bool FixedTimeEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

internal sealed class IdentityDesignTimeFactory : IDesignTimeDbContextFactory<IdentityDbContext>
{
    public IdentityDbContext CreateDbContext(string[] args) => new(DesignTime.Options<IdentityDbContext>(IdentityDbContext.SchemaName), null);
}
