using HomeBell.BuildingBlocks.Domain;

namespace HomeBell.Modules.Notifications.Domain;

/// <summary>An in-app notification for one user (user-scoped; tenant is context, not ownership).</summary>
public sealed class Notification : Entity
{
    private Notification()
        : base(Guid.Empty)
    {
    }

    public Notification(Guid id, Guid userId, Guid? tenantId, string type, string title, string body, string dataJson, DateTimeOffset createdAt)
        : base(id)
    {
        UserId = userId;
        TenantId = tenantId;
        Type = type;
        Title = title;
        Body = body;
        DataJson = dataJson;
        CreatedAt = createdAt;
    }

    public Guid UserId { get; private set; }

    public Guid? TenantId { get; private set; }

    /// <summary>Contract NotificationType.</summary>
    public string Type { get; private set; } = string.Empty;

    public string Title { get; private set; } = string.Empty;

    public string Body { get; private set; } = string.Empty;

    /// <summary>Deep-link context (string → string), JSON.</summary>
    public string DataJson { get; private set; } = "{}";

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? ReadAt { get; private set; }

    public void MarkRead(DateTimeOffset at) => ReadAt ??= at;
}

/// <summary>Push registration of one app install (FCM for Android and iOS — delivery arrives in Phase 7).</summary>
public sealed class PushToken : Entity
{
    private PushToken()
        : base(Guid.Empty)
    {
    }

    public PushToken(Guid id, Guid userId, Guid deviceInstallId, string provider, string token, DateTimeOffset at)
        : base(id)
    {
        UserId = userId;
        DeviceInstallId = deviceInstallId;
        Provider = provider;
        Token = token;
        CreatedAt = at;
        UpdatedAt = at;
    }

    public Guid UserId { get; private set; }

    public Guid DeviceInstallId { get; private set; }

    /// <summary>Contract PushProvider.</summary>
    public string Provider { get; private set; } = string.Empty;

    public string Token { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public void Replace(string provider, string token, DateTimeOffset at)
    {
        Provider = provider;
        Token = token;
        UpdatedAt = at;
    }
}
