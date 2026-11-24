using HomeBell.BuildingBlocks.Domain;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Schools.Domain;

public sealed class SchoolClass : AggregateRoot, ITenantOwned
{
    private SchoolClass()
        : base(Guid.Empty)
    {
    }

    public SchoolClass(Guid id, Guid tenantId, string name, string? gradeLevel, int sortOrder)
        : base(id)
    {
        TenantId = tenantId;
        Name = name;
        GradeLevel = gradeLevel;
        SortOrder = sortOrder;
    }

    public Guid TenantId { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string? GradeLevel { get; private set; }

    public int SortOrder { get; private set; }

    public void Update(string? name, string? gradeLevel, bool setGrade, int? sortOrder)
    {
        Name = name ?? Name;
        GradeLevel = setGrade ? gradeLevel : GradeLevel;
        SortOrder = sortOrder ?? SortOrder;
    }
}

public sealed class Section : Entity, ITenantOwned
{
    private Section()
        : base(Guid.Empty)
    {
    }

    public Section(Guid id, Guid tenantId, Guid classId, string name)
        : base(id)
    {
        TenantId = tenantId;
        ClassId = classId;
        Name = name;
    }

    public Guid TenantId { get; private set; }

    public Guid ClassId { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public void Rename(string name) => Name = name;
}

/// <summary>Minimal student data (08-security-privacy §5). Children never use the app.</summary>
public sealed class Student : AggregateRoot, ITenantOwned
{
    private Student()
        : base(Guid.Empty)
    {
    }

    public Student(Guid id, Guid tenantId, string? externalRef, string firstName, string lastName, string? preferredName, Guid classId, Guid? sectionId, string eligibility, string? notes, string? restrictionsNote, DateTimeOffset at)
        : base(id)
    {
        TenantId = tenantId;
        ExternalRef = externalRef;
        FirstName = firstName;
        LastName = lastName;
        PreferredName = preferredName;
        ClassId = classId;
        SectionId = sectionId;
        DismissalEligibility = eligibility;
        Notes = notes;
        RestrictionsNote = restrictionsNote;
        CreatedAt = at;
        UpdatedAt = at;
        Status = StudentStatus.Active;
    }

    public Guid TenantId { get; private set; }

    public string? ExternalRef { get; set; }

    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;

    public string? PreferredName { get; set; }

    public Guid ClassId { get; set; }

    public Guid? SectionId { get; set; }

    /// <summary>Contract StudentStatus.</summary>
    public string Status { get; private set; } = StudentStatus.Active;

    /// <summary>Contract DismissalEligibility.</summary>
    public string DismissalEligibility { get; set; } = BuildingBlocks.Domain.Contract.DismissalEligibility.Eligible;

    public string? Notes { get; set; }

    /// <summary>Sensitive (custody restrictions); only visible with school.students.write.</summary>
    public string? RestrictionsNote { get; set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public string FullName => $"{PreferredName ?? FirstName} {LastName}";

    public void Touch(DateTimeOffset at) => UpdatedAt = at;

    public void SetStatus(string status, DateTimeOffset at)
    {
        Status = status;
        UpdatedAt = at;
    }
}

/// <summary>Per-tenant settings document (contract TenantSettings), stored as JSON.</summary>
public sealed class TenantSettingsRecord : ITenantOwned
{
    private TenantSettingsRecord()
    {
    }

    public TenantSettingsRecord(Guid tenantId, string json, DateTimeOffset at)
    {
        TenantId = tenantId;
        Json = json;
        UpdatedAt = at;
    }

    public Guid TenantId { get; private set; }

    public string Json { get; private set; } = "{}";

    public DateTimeOffset UpdatedAt { get; private set; }

    public void Replace(string json, DateTimeOffset at)
    {
        Json = json;
        UpdatedAt = at;
    }
}

/// <summary>Two-step CSV import (validate → preview → commit). Rows are kept as JSON for the preview.</summary>
public sealed class ImportJob : AggregateRoot, ITenantOwned
{
    private ImportJob()
        : base(Guid.Empty)
    {
    }

    public ImportJob(Guid id, Guid tenantId, string type, string fileName, Guid? createdById, string createdByName, string summaryJson, string rowsJson, DateTimeOffset at)
        : base(id)
    {
        TenantId = tenantId;
        Type = type;
        FileName = fileName;
        CreatedById = createdById;
        CreatedByName = createdByName;
        SummaryJson = summaryJson;
        RowsJson = rowsJson;
        CreatedAt = at;
        Status = ImportStatus.Validated;
    }

    public Guid TenantId { get; private set; }

    public string Type { get; private set; } = ImportType.StudentsWithGuardians;

    /// <summary>Contract ImportStatus.</summary>
    public string Status { get; private set; } = ImportStatus.Validated;

    public string FileName { get; private set; } = string.Empty;

    public Guid? CreatedById { get; private set; }

    public string CreatedByName { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? CommittedAt { get; private set; }

    public string? FailureReason { get; private set; }

    public string SummaryJson { get; private set; } = "{}";

    public string RowsJson { get; private set; } = "[]";

    public void Commit(DateTimeOffset at)
    {
        Status = ImportStatus.Completed;
        CommittedAt = at;
    }
}
