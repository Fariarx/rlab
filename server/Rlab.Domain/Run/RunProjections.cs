using Rlab.Domain.Metadata;

namespace Rlab.Domain.Run;

[RlabProjection("run-view", Version = 1, DependsOn = ["run.requested", "run.started", "run.outputRecorded", "run.waitingForInput", "run.inputProvided", "run.completed", "run.failed", "run.cancelled"])]
public sealed class RunViewProjection;
