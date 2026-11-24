namespace HomeBell.Modules.Notifications.Contracts;

/// <summary>Creates in-app notifications (pickup status, access changes…); push delivery is added in Phase 7.</summary>
public interface INotifier
{
    Task<Guid> NotifyAsync(Guid userId, Guid? tenantId, string type, string title, string body, IReadOnlyDictionary<string, string>? data, CancellationToken cancellationToken);
}
