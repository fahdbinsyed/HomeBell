namespace HomeBell.Modules.Identity.Contracts;

/// <summary>Sends an OTP code. SMS in production; development sends to the local Mailpit inbox (never logs the code).</summary>
public interface IOtpSender
{
    Task SendAsync(string phoneE164, string code, string purpose, CancellationToken cancellationToken);
}

/// <summary>Sends transactional email (password reset, staff invitations).</summary>
public interface IEmailSender
{
    Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken);
}

/// <summary>Account operations other modules need (school import creates guardian accounts by phone — ADR-0007).</summary>
public interface IUserAccounts
{
    /// <summary>Finds the account for this phone or creates one; returns its id.</summary>
    Task<Guid> EnsureByPhoneAsync(string phoneE164, string fullName, CancellationToken cancellationToken);

    /// <summary>Finds the account for this email or creates one (no password yet); returns its id.</summary>
    Task<Guid> EnsureByEmailAsync(string email, string fullName, CancellationToken cancellationToken);
}
