using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Text;

namespace Rlab.Generators;

[Generator]
public sealed class RlabModelRegistryGenerator : IIncrementalGenerator
{
    private const string AttributeNamespace = "Rlab.Domain.Metadata";

    private static readonly DiagnosticDescriptor DuplicateDescriptor = new(
        "RLAB001",
        "Duplicate RLab model registration",
        "Duplicate {0} registration for '{1}' version {2}",
        "RlabModelRegistry",
        DiagnosticSeverity.Error,
        true);

    private static readonly DiagnosticDescriptor EmptyAggregateDescriptor = new(
        "RLAB002",
        "Aggregate does not apply events",
        "Aggregate '{0}' must define at least one Apply(<event>) method",
        "RlabModelRegistry",
        DiagnosticSeverity.Error,
        true);

    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        var models = context.SyntaxProvider
            .CreateSyntaxProvider(static (node, _) => IsCandidate(node), static (ctx, _) => BuildModel(ctx))
            .Where(static model => model is not null)
            .Select(static (model, _) => model!.Value)
            .Collect();

        var services = context.SyntaxProvider
            .CreateSyntaxProvider(static (node, _) => node is ClassDeclarationSyntax, static (ctx, _) => BuildService(ctx))
            .Where(static service => service is not null)
            .Select(static (service, _) => service!.Value)
            .Collect();

        var projectionAppliers = context.SyntaxProvider
            .CreateSyntaxProvider(static (node, _) => node is ClassDeclarationSyntax, static (ctx, _) => BuildProjectionApplier(ctx))
            .Where(static applier => applier is not null)
            .Select(static (applier, _) => applier!.Value)
            .Collect();

        context.RegisterSourceOutput(models.Combine(projectionAppliers), static (ctx, source) => EmitRegistry(ctx, source.Left, source.Right));
        context.RegisterSourceOutput(services, EmitServiceRegistration);
    }

    private static bool IsCandidate(SyntaxNode node) =>
        node is TypeDeclarationSyntax { AttributeLists.Count: > 0 };

    private static ModelInfo? BuildModel(GeneratorSyntaxContext context)
    {
        if (context.SemanticModel.GetDeclaredSymbol(context.Node) is not INamedTypeSymbol type)
        {
            return null;
        }

        foreach (var attribute in type.GetAttributes())
        {
            var attributeName = attribute.AttributeClass?.ToDisplayString();
            if (attributeName is null || !attributeName.StartsWith(AttributeNamespace, StringComparison.Ordinal))
            {
                continue;
            }

            var wireName = attribute.ConstructorArguments.FirstOrDefault().Value as string;
            var version = ReadInt(attribute, "Version", 1);
            if (string.IsNullOrWhiteSpace(wireName))
            {
                continue;
            }

            if (attributeName.EndsWith(".RlabEventAttribute", StringComparison.Ordinal))
            {
                return Create(type, "Event", wireName!, version, ImmutableArray<string>.Empty, ImmutableArray<string>.Empty);
            }

            if (attributeName.EndsWith(".RlabCommandAttribute", StringComparison.Ordinal))
            {
                return Create(type, "Command", wireName!, version, ImmutableArray<string>.Empty, ImmutableArray<string>.Empty);
            }

            if (attributeName.EndsWith(".RlabQueryAttribute", StringComparison.Ordinal))
            {
                return Create(type, "Query", wireName!, version, ImmutableArray<string>.Empty, ImmutableArray<string>.Empty);
            }

            if (attributeName.EndsWith(".RlabProjectionAttribute", StringComparison.Ordinal))
            {
                var dependencies = ReadStringArray(attribute, "DependsOn");
                return Create(type, "Projection", wireName!, version, dependencies, ImmutableArray<string>.Empty);
            }

            if (attributeName.EndsWith(".RlabAggregateAttribute", StringComparison.Ordinal))
            {
                var handledEvents = type.GetMembers()
                    .OfType<IMethodSymbol>()
                    .Where(method => method.Name == "Apply" && method.Parameters.Length == 1)
                    .Select(method => method.Parameters[0].Type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(name => name, StringComparer.Ordinal)
                    .ToImmutableArray();
                return Create(type, "Aggregate", wireName!, version, ImmutableArray<string>.Empty, handledEvents);
            }
        }

        return null;
    }

    private static ModelInfo Create(
        INamedTypeSymbol type,
        string kind,
        string wireName,
        int version,
        ImmutableArray<string> dependencies,
        ImmutableArray<string> handledEvents)
    {
        var clrType = type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);
        return new ModelInfo(kind, wireName, version, clrType, type.Name, SchemaHash(type), dependencies, handledEvents, type.Locations.FirstOrDefault());
    }

    private static int ReadInt(AttributeData attribute, string name, int fallback)
    {
        foreach (var argument in attribute.NamedArguments)
        {
            if (argument.Key == name && argument.Value.Value is int value)
            {
                return value;
            }
        }

        return fallback;
    }

    private static ImmutableArray<string> ReadStringArray(AttributeData attribute, string name)
    {
        foreach (var argument in attribute.NamedArguments)
        {
            if (argument.Key == name)
            {
                return argument.Value.Values
                    .Select(value => value.Value as string)
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Select(value => value!)
                    .ToImmutableArray();
            }
        }

        return ImmutableArray<string>.Empty;
    }

    private static string SchemaHash(INamedTypeSymbol type)
    {
        var members = type.GetMembers()
            .OfType<IPropertySymbol>()
            .Where(property => !property.IsStatic && property.DeclaredAccessibility == Accessibility.Public)
            .Select(property => $"{property.Name}:{property.Type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat)}")
            .OrderBy(value => value, StringComparer.Ordinal);
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(string.Join("|", members)));
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }

    private static void EmitRegistry(SourceProductionContext context, ImmutableArray<ModelInfo> models, ImmutableArray<ProjectionApplierInfo> projectionAppliers)
    {
        if (models.Length == 0)
        {
            return;
        }

        foreach (var duplicate in models.GroupBy(model => $"{model.Kind}:{model.WireName}:v{model.Version}", StringComparer.Ordinal).Where(group => group.Count() > 1))
        {
            var first = duplicate.First();
            context.ReportDiagnostic(Diagnostic.Create(DuplicateDescriptor, first.Location, first.Kind, first.WireName, first.Version));
        }

        foreach (var aggregate in models.Where(model => model.Kind == "Aggregate" && model.HandledEvents.Length == 0))
        {
            context.ReportDiagnostic(Diagnostic.Create(EmptyAggregateDescriptor, aggregate.Location, aggregate.ClrType));
        }

        var source = new StringBuilder();
        source.AppendLine("// <auto-generated />");
        source.AppendLine("#nullable enable");
        source.AppendLine("using System;");
        source.AppendLine("using System.Collections.Immutable;");
        source.AppendLine("using System.Text.Json;");
        source.AppendLine("using Rlab.Domain.Metadata;");
        source.AppendLine();
        source.AppendLine("namespace Rlab.Domain.Generated;");
        source.AppendLine();
        source.AppendLine("public static partial class RlabGeneratedRegistry");
        source.AppendLine("{");
        source.AppendLine("    public static RlabModelRegistry Create() => new RlabModelRegistry(ImmutableArray.Create<RlabModelDescriptor>(");

        var orderedModels = models
            .OrderBy(model => model.Kind, StringComparer.Ordinal)
            .ThenBy(model => model.WireName, StringComparer.Ordinal)
            .ThenBy(model => model.Version)
            .ToArray();

        for (var index = 0; index < orderedModels.Length; index++)
        {
            var model = orderedModels[index];
            source.Append("        new RlabModelDescriptor(RlabModelKind.")
                .Append(model.Kind)
                .Append(", \"")
                .Append(Escape(model.WireName))
                .Append("\", ")
                .Append(model.Version)
                .Append(", \"")
                .Append(Escape(model.ClrType.Replace("global::", "")))
                .Append("\", \"")
                .Append(model.SchemaHash)
                .Append("\", ")
                .Append(ImmutableArrayExpression(model.Dependencies))
                .Append(", ")
                .Append(ImmutableArrayExpression(model.HandledEvents.Select(value => value.Replace("global::", "")).ToImmutableArray()))
                .Append(")");

            if (index + 1 < orderedModels.Length)
            {
                source.Append(",");
            }

            source.AppendLine();
        }

        source.AppendLine("    ));");
        source.AppendLine();
        EmitProjectionApplierTypes(source, projectionAppliers);
        source.AppendLine();
        EmitStreamNames(source, orderedModels);
        source.AppendLine();
        EmitTypeResolver(source, orderedModels);
        source.AppendLine();
        EmitDeserializer(source, orderedModels);
        source.AppendLine("}");
        context.AddSource("RlabGeneratedRegistry.g.cs", SourceText.From(source.ToString(), Encoding.UTF8));
    }

    private static ServiceInfo? BuildService(GeneratorSyntaxContext context)
    {
        if (context.SemanticModel.GetDeclaredSymbol(context.Node) is not INamedTypeSymbol type)
        {
            return null;
        }

        if (type.TypeKind != TypeKind.Class || type.IsAbstract || type.DeclaredAccessibility != Accessibility.Public)
        {
            return null;
        }

        foreach (var contract in type.AllInterfaces)
        {
            var name = contract.ToDisplayString();
            if (name == "Rlab.Domain.Contracts.IRlabCommandHandler")
            {
                return new ServiceInfo("Rlab.Domain.Contracts.IRlabCommandHandler", type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat), type.Locations.FirstOrDefault());
            }

            if (name == "Rlab.Domain.Contracts.IRlabQueryHandler")
            {
                return new ServiceInfo("Rlab.Domain.Contracts.IRlabQueryHandler", type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat), type.Locations.FirstOrDefault());
            }
        }

        return null;
    }

    private static ProjectionApplierInfo? BuildProjectionApplier(GeneratorSyntaxContext context)
    {
        if (context.SemanticModel.GetDeclaredSymbol(context.Node) is not INamedTypeSymbol type)
        {
            return null;
        }

        if (type.TypeKind != TypeKind.Class || type.IsAbstract || type.DeclaredAccessibility != Accessibility.Public)
        {
            return null;
        }

        var implementsProjectionApplier = type.AllInterfaces
            .Any(contract => contract.ToDisplayString() == "Rlab.Domain.Contracts.IRlabProjectionApplier");

        return implementsProjectionApplier
            ? new ProjectionApplierInfo(type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat), type.Locations.FirstOrDefault())
            : null;
    }

    private static void EmitServiceRegistration(SourceProductionContext context, ImmutableArray<ServiceInfo> services)
    {
        if (services.Length == 0)
        {
            return;
        }

        var source = new StringBuilder();
        source.AppendLine("// <auto-generated />");
        source.AppendLine("#nullable enable");
        source.AppendLine();
        source.AppendLine("namespace Rlab.Infrastructure.Generated;");
        source.AppendLine();
        source.AppendLine("public static partial class RlabGeneratedServiceRegistration");
        source.AppendLine("{");
        source.AppendLine("    public static global::Microsoft.Extensions.DependencyInjection.IServiceCollection AddGeneratedRlabInfrastructureServices(this global::Microsoft.Extensions.DependencyInjection.IServiceCollection services)");
        source.AppendLine("    {");

        foreach (var service in services.OrderBy(service => service.ServiceType, StringComparer.Ordinal).ThenBy(service => service.ImplementationType, StringComparer.Ordinal))
        {
            source.Append("        global::Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddScoped<global::")
                .Append(service.ServiceType)
                .Append(", ")
                .Append(service.ImplementationType)
                .AppendLine(">(services);");
        }

        source.AppendLine("        return services;");
        source.AppendLine("    }");
        source.AppendLine("}");

        context.AddSource("RlabGeneratedServiceRegistration.g.cs", SourceText.From(source.ToString(), Encoding.UTF8));
    }

    private static void EmitTypeResolver(StringBuilder source, ModelInfo[] orderedModels)
    {
        source.AppendLine("    public static Type ResolveType(string clrType) => clrType switch");
        source.AppendLine("    {");

        foreach (var model in orderedModels)
        {
            var clrType = model.ClrType.Replace("global::", "");
            source.Append("        \"")
                .Append(Escape(clrType))
                .Append("\" => typeof(global::")
                .Append(clrType)
                .AppendLine("),");
        }

        source.AppendLine("        _ => throw new InvalidOperationException($\"Unknown RLab model CLR type '{clrType}'.\")");
        source.AppendLine("    };");
    }

    private static void EmitProjectionApplierTypes(StringBuilder source, ImmutableArray<ProjectionApplierInfo> projectionAppliers)
    {
        source.AppendLine("    public static ImmutableArray<Type> ProjectionApplierTypes => ImmutableArray.Create<Type>(");

        var orderedAppliers = projectionAppliers
            .OrderBy(applier => applier.ImplementationType, StringComparer.Ordinal)
            .ToArray();

        for (var index = 0; index < orderedAppliers.Length; index++)
        {
            var implementationType = orderedAppliers[index].ImplementationType.Replace("global::", "");
            source.Append("        typeof(global::")
                .Append(implementationType)
                .Append(")");

            if (index + 1 < orderedAppliers.Length)
            {
                source.Append(",");
            }

            source.AppendLine();
        }

        source.AppendLine("    );");
    }

    private static void EmitStreamNames(StringBuilder source, ModelInfo[] orderedModels)
    {
        foreach (var aggregate in orderedModels.Where(model => model.Kind == "Aggregate"))
        {
            var methodName = aggregate.SimpleTypeName.EndsWith("Aggregate", StringComparison.Ordinal)
                ? aggregate.SimpleTypeName.Substring(0, aggregate.SimpleTypeName.Length - "Aggregate".Length)
                : aggregate.SimpleTypeName;

            if (aggregate.WireName == "workspace")
            {
                source.Append("    public static string ")
                    .Append(methodName)
                    .Append("Stream() => \"")
                    .Append(Escape(aggregate.WireName))
                    .AppendLine("\";");
            }
            else
            {
                source.Append("    public static string ")
                    .Append(methodName)
                    .Append("Stream(string aggregateId) => string.IsNullOrWhiteSpace(aggregateId) ? throw new InvalidOperationException(\"Aggregate id is required for stream '")
                    .Append(Escape(aggregate.WireName))
                    .Append("'.\") : $\"")
                    .Append(Escape(aggregate.WireName))
                    .Append(":{aggregateId}\";")
                    .AppendLine();
            }
        }
    }

    private static void EmitDeserializer(StringBuilder source, ModelInfo[] orderedModels)
    {
        source.AppendLine("    public static object DeserializeModel(RlabModelKind kind, string wireName, int version, JsonElement data, JsonSerializerOptions options) => (kind, wireName, version) switch");
        source.AppendLine("    {");

        foreach (var model in orderedModels.Where(model => model.Kind is "Command" or "Query" or "Event"))
        {
            var clrType = model.ClrType.Replace("global::", "");
            source.Append("        (RlabModelKind.")
                .Append(model.Kind)
                .Append(", \"")
                .Append(Escape(model.WireName))
                .Append("\", ")
                .Append(model.Version)
                .Append(") => data.Deserialize<global::")
                .Append(clrType)
                .AppendLine(">(options) ?? throw new InvalidOperationException(\"Could not deserialize RLab model payload.\"),");
        }

        source.AppendLine("        _ => throw new InvalidOperationException($\"Unknown RLab model '{kind}:{wireName}:v{version}'.\")");
        source.AppendLine("    };");
    }

    private static string Escape(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private static string ImmutableArrayExpression(ImmutableArray<string> values)
    {
        if (values.Length == 0)
        {
            return "ImmutableArray<string>.Empty";
        }

        return $"ImmutableArray.Create({string.Join(", ", values.Select(value => $"\"{Escape(value)}\""))})";
    }

    private readonly struct ModelInfo
    {
        public ModelInfo(
            string kind,
            string wireName,
            int version,
            string clrType,
            string simpleTypeName,
            string schemaHash,
            ImmutableArray<string> dependencies,
            ImmutableArray<string> handledEvents,
            Location? location)
        {
            Kind = kind;
            WireName = wireName;
            Version = version;
            ClrType = clrType;
            SimpleTypeName = simpleTypeName;
            SchemaHash = schemaHash;
            Dependencies = dependencies;
            HandledEvents = handledEvents;
            Location = location;
        }

        public string Kind { get; }

        public string WireName { get; }

        public int Version { get; }

        public string ClrType { get; }

        public string SimpleTypeName { get; }

        public string SchemaHash { get; }

        public ImmutableArray<string> Dependencies { get; }

        public ImmutableArray<string> HandledEvents { get; }

        public Location? Location { get; }
    }

    private readonly struct ServiceInfo
    {
        public ServiceInfo(string serviceType, string implementationType, Location? location)
        {
            ServiceType = serviceType;
            ImplementationType = implementationType;
            Location = location;
        }

        public string ServiceType { get; }

        public string ImplementationType { get; }

        public Location? Location { get; }
    }

    private readonly struct ProjectionApplierInfo
    {
        public ProjectionApplierInfo(string implementationType, Location? location)
        {
            ImplementationType = implementationType;
            Location = location;
        }

        public string ImplementationType { get; }

        public Location? Location { get; }
    }
}
