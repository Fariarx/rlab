using System.Collections.Immutable;

namespace Rlab.Domain.Metadata;

public enum RlabModelKind
{
    Command,
    Event,
    Query,
    Projection,
    Aggregate
}

public sealed record RlabModelDescriptor(
    RlabModelKind Kind,
    string WireName,
    int Version,
    string ClrType,
    string SchemaHash,
    ImmutableArray<string> Dependencies,
    ImmutableArray<string> HandledEventClrTypes)
{
    public string Identity => $"{Kind}:{WireName}:v{Version}";
}

public sealed record RlabModelRegistry(ImmutableArray<RlabModelDescriptor> Models)
{
    public RlabModelDescriptor? Find(RlabModelKind kind, string wireName, int version) =>
        Models.FirstOrDefault(model => model.Kind == kind && model.WireName == wireName && model.Version == version);

    public ImmutableArray<RlabModelDescriptor> Events => Models.Where(model => model.Kind == RlabModelKind.Event).ToImmutableArray();

    public ImmutableArray<RlabModelDescriptor> Commands => Models.Where(model => model.Kind == RlabModelKind.Command).ToImmutableArray();

    public ImmutableArray<RlabModelDescriptor> Queries => Models.Where(model => model.Kind == RlabModelKind.Query).ToImmutableArray();

    public ImmutableArray<RlabModelDescriptor> Projections => Models.Where(model => model.Kind == RlabModelKind.Projection).ToImmutableArray();

    public ImmutableArray<RlabModelDescriptor> Aggregates => Models.Where(model => model.Kind == RlabModelKind.Aggregate).ToImmutableArray();
}
