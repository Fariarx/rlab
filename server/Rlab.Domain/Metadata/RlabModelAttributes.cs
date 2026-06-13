namespace Rlab.Domain.Metadata;

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, AllowMultiple = false, Inherited = false)]
public sealed class RlabEventAttribute(string wireName) : Attribute
{
    public string WireName { get; } = wireName;
    public int Version { get; init; } = 1;
}

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, AllowMultiple = false, Inherited = false)]
public sealed class RlabCommandAttribute(string wireName) : Attribute
{
    public string WireName { get; } = wireName;
    public int Version { get; init; } = 1;
}

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, AllowMultiple = false, Inherited = false)]
public sealed class RlabQueryAttribute(string wireName) : Attribute
{
    public string WireName { get; } = wireName;
    public int Version { get; init; } = 1;
}

[AttributeUsage(AttributeTargets.Class, AllowMultiple = false, Inherited = false)]
public sealed class RlabProjectionAttribute(string name) : Attribute
{
    public string Name { get; } = name;
    public int Version { get; init; } = 1;
    public string[] DependsOn { get; init; } = [];
}

[AttributeUsage(AttributeTargets.Class, AllowMultiple = false, Inherited = false)]
public sealed class RlabAggregateAttribute(string streamPrefix) : Attribute
{
    public string StreamPrefix { get; } = streamPrefix;
}
