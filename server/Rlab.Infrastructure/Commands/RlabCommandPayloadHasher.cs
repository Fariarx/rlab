using System.Security.Cryptography;
using System.Text;
using Rlab.Domain.Contracts;

namespace Rlab.Infrastructure.Commands;

public static class RlabCommandPayloadHasher
{
    public static string Compute(RlabCommandEnvelope envelope)
    {
        var payload = string.Join(
            "\n",
            envelope.Type,
            envelope.Version.ToString(),
            envelope.Data.GetRawText());
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
