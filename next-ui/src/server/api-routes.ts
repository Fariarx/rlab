import { methodOnly, type ApiHandler, type ExactApiRoute } from "./api-router";

export interface RlabApiRouteHandlers {
  readonly health: ApiHandler;
  readonly browserSession: ApiHandler;
  readonly browserSync: ApiHandler;
  readonly browserDirty: ApiHandler;
  readonly browserAction: ApiHandler;
  readonly browserBridgeSync: ApiHandler;
  readonly browserBridgeAction: ApiHandler;
  readonly browserBridgeSnapshot: ApiHandler;
  readonly browserSnapshot: ApiHandler;
  readonly browserEvents: ApiHandler;
  readonly commands: ApiHandler;
  readonly stateSnapshot: ApiHandler;
  readonly stateThread: ApiHandler;
  readonly stateEvents: ApiHandler;
  readonly agents: ApiHandler;
  readonly rlabPlugins: ApiHandler;
  readonly agentConfig: ApiHandler;
  readonly voiceConfig: ApiHandler;
  readonly voiceTranscribe: ApiHandler;
  readonly agentInstall: ApiHandler;
  readonly playwrightInstall: ApiHandler;
  readonly folderPicker: ApiHandler;
  readonly listDirectories: ApiHandler;
  readonly folderInfo: ApiHandler;
  readonly projectFiles: ApiHandler;
  readonly attachments: ApiHandler;
  readonly localFile: ApiHandler;
  readonly version: ApiHandler;
  readonly agentLimits: ApiHandler;
  readonly cliUpdates: ApiHandler;
  readonly gitStatus: ApiHandler;
  readonly gitTree: ApiHandler;
  readonly gitDiff: ApiHandler;
  readonly gitStage: ApiHandler;
  readonly gitUnstage: ApiHandler;
  readonly gitCommit: ApiHandler;
  readonly gitCheckout: ApiHandler;
  readonly gitPush: ApiHandler;
  readonly gitWorktreeCreate: ApiHandler;
  readonly gitWorktreeMerge: ApiHandler;
  readonly gitInit: ApiHandler;
  readonly terminal: ApiHandler;
  readonly runs: ApiHandler;
  readonly wakeups: ApiHandler;
  readonly runAttach: ApiHandler;
  readonly run: ApiHandler;
  readonly runApproval: ApiHandler;
  readonly runCancel: ApiHandler;
  readonly runInput: ApiHandler;
}

export function createRlabApiRoutes(handlers: RlabApiRouteHandlers): readonly ExactApiRoute[] {
  return [
    { path: "/api/health", handler: methodOnly("GET", handlers.health) },
    { path: "/api/browser/session", handler: methodOnly("POST", handlers.browserSession) },
    { path: "/api/browser/sync", handler: methodOnly("POST", handlers.browserSync) },
    { path: "/api/browser/dirty", handler: methodOnly("POST", handlers.browserDirty) },
    { path: "/api/browser/action", handler: methodOnly("POST", handlers.browserAction) },
    { path: "/api/browser/bridge/sync", handler: methodOnly("POST", handlers.browserBridgeSync) },
    { path: "/api/browser/bridge/action", handler: methodOnly("POST", handlers.browserBridgeAction) },
    { path: "/api/browser/bridge/snapshot", handler: methodOnly("GET", handlers.browserBridgeSnapshot) },
    { path: "/api/browser/snapshot", handler: methodOnly("GET", handlers.browserSnapshot) },
    { path: "/api/browser/events", handler: methodOnly("GET", handlers.browserEvents) },
    { path: "/api/commands", handler: methodOnly("POST", handlers.commands) },
    { path: "/api/state/snapshot", handler: methodOnly("GET", handlers.stateSnapshot) },
    { path: "/api/state/thread", handler: methodOnly("GET", handlers.stateThread) },
    { path: "/api/state/events", handler: methodOnly("GET", handlers.stateEvents) },
    { path: "/api/agents", handler: methodOnly("GET", handlers.agents) },
    { path: "/api/rlab-plugins", handler: methodOnly("GET", handlers.rlabPlugins) },
    { path: "/api/agent-config", handler: handlers.agentConfig },
    { path: "/api/voice-config", handler: handlers.voiceConfig },
    { path: "/api/voice/transcribe", handler: methodOnly("POST", handlers.voiceTranscribe) },
    { path: "/api/agent-install", handler: methodOnly("POST", handlers.agentInstall) },
    { path: "/api/playwright-install", handler: methodOnly("POST", handlers.playwrightInstall) },
    { path: "/api/folder-picker", handler: methodOnly("POST", handlers.folderPicker) },
    { path: "/api/list-directories", handler: methodOnly("POST", handlers.listDirectories) },
    { path: "/api/folder-info", handler: methodOnly("POST", handlers.folderInfo) },
    { path: "/api/project-files", handler: methodOnly("POST", handlers.projectFiles) },
    { path: "/api/attachments", handler: methodOnly("POST", handlers.attachments) },
    { path: "/api/local-file", handler: methodOnly("GET", handlers.localFile) },
    { path: "/api/version", handler: methodOnly("GET", handlers.version) },
    { path: "/api/agent-limits", handler: methodOnly("GET", handlers.agentLimits) },
    { path: "/api/cli-updates", handler: methodOnly("GET", handlers.cliUpdates) },
    { path: "/api/git-status", handler: methodOnly("POST", handlers.gitStatus) },
    { path: "/api/git-tree", handler: methodOnly("POST", handlers.gitTree) },
    { path: "/api/git-diff", handler: methodOnly("POST", handlers.gitDiff) },
    { path: "/api/git-stage", handler: methodOnly("POST", handlers.gitStage) },
    { path: "/api/git-unstage", handler: methodOnly("POST", handlers.gitUnstage) },
    { path: "/api/git-commit", handler: methodOnly("POST", handlers.gitCommit) },
    { path: "/api/git-checkout", handler: methodOnly("POST", handlers.gitCheckout) },
    { path: "/api/git-push", handler: methodOnly("POST", handlers.gitPush) },
    { path: "/api/git-worktree-create", handler: methodOnly("POST", handlers.gitWorktreeCreate) },
    { path: "/api/git-worktree-merge", handler: methodOnly("POST", handlers.gitWorktreeMerge) },
    { path: "/api/git-init", handler: methodOnly("POST", handlers.gitInit) },
    { path: "/api/terminal", handler: handlers.terminal },
    { path: "/api/runs", handler: methodOnly("GET", handlers.runs) },
    { path: "/api/wakeups", handler: handlers.wakeups },
    { path: "/api/run-attach", handler: methodOnly("GET", handlers.runAttach) },
    { path: "/api/run", handler: methodOnly("POST", handlers.run) },
    { path: "/api/run-approval", handler: methodOnly("POST", handlers.runApproval) },
    { path: "/api/run-cancel", handler: methodOnly("POST", handlers.runCancel) },
    { path: "/api/run-input", handler: methodOnly("POST", handlers.runInput) },
  ];
}
