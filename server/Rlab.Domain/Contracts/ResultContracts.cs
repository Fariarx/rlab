using System.Runtime.CompilerServices;

namespace Rlab.Domain.Contracts;

public sealed record RlabError(
    string Message,
    string MemberName,
    string FilePath,
    int LineNumber)
{
    public static RlabError Create(
        string message,
        [CallerMemberName] string memberName = "",
        [CallerFilePath] string filePath = "",
        [CallerLineNumber] int lineNumber = 0)
    {
        return new RlabError(message, memberName, filePath, lineNumber);
    }
}

public readonly record struct RlabUnit
{
    public static RlabUnit Value { get; } = new();
}

public sealed class RlabResult<T>
{
    private readonly T? _value;
    private readonly RlabError? _error;

    private RlabResult(T? value, RlabError? error)
    {
        _value = value;
        _error = error;
    }

    public bool IsSuccess => _error is null;

    public bool IsFailure => _error is not null;

    public T Value => IsSuccess
        ? _value!
        : throw new InvalidOperationException("Cannot read the value of a failed RLab result.");

    public RlabError Error => _error
        ?? throw new InvalidOperationException("Cannot read the error of a successful RLab result.");

    public TResult Match<TResult>(Func<T, TResult> success, Func<RlabError, TResult> failure)
    {
        return IsSuccess ? success(Value) : failure(Error);
    }

    public RlabResult<TResult> Map<TResult>(Func<T, TResult> selector)
    {
        return IsSuccess ? RlabResult.Success(selector(Value)) : RlabResult.Failure<TResult>(Error);
    }

    public RlabResult<TResult> Bind<TResult>(Func<T, RlabResult<TResult>> binder)
    {
        return IsSuccess ? binder(Value) : RlabResult.Failure<TResult>(Error);
    }

    public RlabResult<TResult> ErrorOf<TResult>()
    {
        return RlabResult.Failure<TResult>(Error);
    }

    public static RlabResult<T> Success(T value)
    {
        return new RlabResult<T>(value, null);
    }

    public static RlabResult<T> Failure(RlabError error)
    {
        return new RlabResult<T>(default, error);
    }
}

public static class RlabResult
{
    public static RlabResult<T> Success<T>(T value)
    {
        return RlabResult<T>.Success(value);
    }

    public static RlabResult<RlabUnit> Success()
    {
        return RlabResult<RlabUnit>.Success(RlabUnit.Value);
    }

    public static RlabResult<T> Failure<T>(RlabError error)
    {
        return RlabResult<T>.Failure(error);
    }

    public static RlabResult<T> Failure<T>(
        string message,
        [CallerMemberName] string memberName = "",
        [CallerFilePath] string filePath = "",
        [CallerLineNumber] int lineNumber = 0)
    {
        return Failure<T>(RlabError.Create(message, memberName, filePath, lineNumber));
    }
}

public static class RlabResultExtensions
{
    public static RlabResult<T> AsSuccess<T>(this T value)
    {
        return RlabResult.Success(value);
    }

    public static RlabResult<T> AsFailure<T>(
        this string message,
        [CallerMemberName] string memberName = "",
        [CallerFilePath] string filePath = "",
        [CallerLineNumber] int lineNumber = 0)
    {
        return RlabResult.Failure<T>(RlabError.Create(message, memberName, filePath, lineNumber));
    }

    public static async ValueTask<RlabResult<TResult>> BindAsync<T, TResult>(
        this RlabResult<T> result,
        Func<T, ValueTask<RlabResult<TResult>>> binder)
    {
        return result.IsSuccess
            ? await binder(result.Value).ConfigureAwait(false)
            : RlabResult.Failure<TResult>(result.Error);
    }

    public static async ValueTask<RlabResult<TResult>> ThenAsync<TResult>(
        this RlabResult<RlabUnit> result,
        Func<ValueTask<RlabResult<TResult>>> binder)
    {
        return result.IsSuccess
            ? await binder().ConfigureAwait(false)
            : RlabResult.Failure<TResult>(result.Error);
    }
}
