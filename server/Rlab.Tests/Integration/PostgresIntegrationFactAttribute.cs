namespace Rlab.Tests.Integration;

public sealed class PostgresIntegrationFactAttribute : FactAttribute
{
    public PostgresIntegrationFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(PostgresIntegration.ConnectionStringEnvironmentVariable)))
        {
            Skip = $"Set {PostgresIntegration.ConnectionStringEnvironmentVariable} to run PostgreSQL integration tests.";
        }
    }
}

public static class PostgresIntegration
{
    public const string ConnectionStringEnvironmentVariable = "RLAB_POSTGRES_TEST_CONNECTION_STRING";
}
