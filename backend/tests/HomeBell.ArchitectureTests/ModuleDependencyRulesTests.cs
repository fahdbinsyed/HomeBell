using System.Xml.Linq;

namespace HomeBell.ArchitectureTests;

/// <summary>
/// Enforces docs/architecture/01-backend-modules.md §3 by inspecting declared project and package
/// references (declared references are checked, not just the ones the compiler keeps).
/// </summary>
public sealed class ModuleDependencyRulesTests
{
    private static readonly string[] Layers = ["Contracts", "Domain", "Application", "Infrastructure"];

    private static readonly Lazy<IReadOnlyList<ProjectInfo>> AllProjects = new(LoadProjects);

    private static IReadOnlyList<ProjectInfo> Projects => AllProjects.Value;

    private static IEnumerable<ProjectInfo> ModuleProjects => Projects.Where(p => p.Module is not null);

    [Fact]
    public void Solution_contains_all_expected_modules_with_all_layers()
    {
        string[] expected = ["Platform", "Identity", "Schools", "Guardians", "Dismissal", "Billing", "Notifications", "Audit", "Reporting"];
        foreach (var module in expected)
        {
            foreach (var layer in Layers)
            {
                Assert.Contains(ModuleProjects, p => p.Module == module && p.Layer == layer);
            }
        }
    }

    [Fact]
    public void Modules_reference_other_modules_only_through_Contracts()
    {
        var violations = ModuleProjects
            .SelectMany(p => p.ProjectReferences
                .Select(Parse)
                .Where(r => r.Module is not null && r.Module != p.Module && r.Layer != "Contracts")
                .Select(r => $"{p.Name} -> {r.Name}"))
            .ToList();
        Assert.True(violations.Count == 0, "Cross-module references must target .Contracts: " + string.Join(", ", violations));
    }

    [Fact]
    public void Contracts_projects_reference_no_HomeBell_projects()
    {
        var violations = ModuleProjects
            .Where(p => p.Layer == "Contracts" && p.ProjectReferences.Count > 0)
            .Select(p => $"{p.Name} -> {string.Join(", ", p.ProjectReferences)}")
            .ToList();
        Assert.True(violations.Count == 0, "Contracts must be dependency-free: " + string.Join("; ", violations));
    }

    [Fact]
    public void Domain_projects_do_not_depend_on_frameworks_or_outer_layers()
    {
        foreach (var p in ModuleProjects.Where(p => p.Layer == "Domain"))
        {
            Assert.All(p.ProjectReferences, r =>
                Assert.True(r == "HomeBell.BuildingBlocks.Domain",
                    $"{p.Name} may only reference BuildingBlocks.Domain (found {r})"));
            Assert.DoesNotContain(p.PackageReferences, pkg =>
                pkg.Contains("EntityFrameworkCore", StringComparison.Ordinal) || pkg.Contains("AspNetCore", StringComparison.Ordinal));
            Assert.False(p.HasAspNetFrameworkReference, $"{p.Name} must not reference Microsoft.AspNetCore.App");
        }
    }

    [Fact]
    public void Application_projects_do_not_reference_Infrastructure()
    {
        var violations = ModuleProjects
            .Where(p => p.Layer == "Application")
            .SelectMany(p => p.ProjectReferences.Where(r => r.EndsWith(".Infrastructure", StringComparison.Ordinal)).Select(r => $"{p.Name} -> {r}"))
            .ToList();
        Assert.True(violations.Count == 0, string.Join(", ", violations));
    }

    [Fact]
    public void BuildingBlocks_do_not_reference_modules()
    {
        var violations = Projects
            .Where(p => p.Name.StartsWith("HomeBell.BuildingBlocks.", StringComparison.Ordinal))
            .SelectMany(p => p.ProjectReferences.Where(r => r.StartsWith("HomeBell.Modules.", StringComparison.Ordinal)).Select(r => $"{p.Name} -> {r}"))
            .ToList();
        Assert.True(violations.Count == 0, string.Join(", ", violations));
    }

    [Fact]
    public void Only_hosts_reference_more_than_one_modules_Infrastructure()
    {
        var violations = Projects
            .Where(p => !p.IsHost)
            .Where(p => p.ProjectReferences.Select(Parse).Count(r => r.Layer == "Infrastructure" && r.Module is not null) > 0)
            .Select(p => p.Name)
            .ToList();
        Assert.True(violations.Count == 0, "Only hosts may reference module Infrastructure: " + string.Join(", ", violations));
    }

    private static (string Name, string? Module, string? Layer) Parse(string projectName)
    {
        var parts = projectName.Split('.');
        return parts is ["HomeBell", "Modules", var module, var layer]
            ? (projectName, module, layer)
            : (projectName, null, null);
    }

    private static IReadOnlyList<ProjectInfo> LoadProjects()
    {
        var backend = FindBackendRoot();
        return Directory.EnumerateFiles(Path.Combine(backend, "src"), "*.csproj", SearchOption.AllDirectories)
            .Select(ProjectInfo.Load)
            .ToList();
    }

    private static string FindBackendRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "HomeBell.slnx")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("Could not locate backend/HomeBell.slnx");
    }

    private sealed record ProjectInfo(
        string Name,
        string? Module,
        string? Layer,
        bool IsHost,
        bool HasAspNetFrameworkReference,
        IReadOnlyList<string> ProjectReferences,
        IReadOnlyList<string> PackageReferences)
    {
        public static ProjectInfo Load(string path)
        {
            var name = Path.GetFileNameWithoutExtension(path);
            var xml = XDocument.Load(path);
            var refs = xml.Descendants("ProjectReference")
                .Select(e => Path.GetFileNameWithoutExtension((string?)e.Attribute("Include") ?? string.Empty))
                .ToList();
            var packages = xml.Descendants("PackageReference").Select(e => (string?)e.Attribute("Include") ?? string.Empty).ToList();
            var aspnet = xml.Descendants("FrameworkReference").Any(e => (string?)e.Attribute("Include") == "Microsoft.AspNetCore.App");
            var (_, module, layer) = Parse(name);
            var isHost = name is "HomeBell.Api" or "HomeBell.Worker";
            return new ProjectInfo(name, module, layer, isHost, aspnet, refs, packages);
        }
    }
}
