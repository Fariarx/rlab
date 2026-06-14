import type { ChatMessage } from "../../agent";
import type { RemoteWorkspaceShellMerge } from "../models/workspace-server-sync-model";

export interface WorkspaceThreadLoaderOptions {
  readonly loadConversationThread: (id: string) => Promise<readonly ChatMessage[]>;
  readonly onLoadedThread: (id: string, messages: readonly ChatMessage[]) => void;
  readonly onLoadError: (message: string) => void;
}

export class WorkspaceThreadLoader {
  private readonly fullyLoadedThreadIds = new Set<string>();

  private readonly threadLoads = new Map<string, Promise<void>>();

  constructor(private readonly options: WorkspaceThreadLoaderOptions) {}

  resetLoadedThreads(threadIds: Iterable<string>): void {
    this.fullyLoadedThreadIds.clear();
    this.threadLoads.clear();
    for (const id of threadIds) {
      this.fullyLoadedThreadIds.add(id);
    }
  }

  reconcileRemoteShell(merge: RemoteWorkspaceShellMerge): void {
    for (const id of [...this.fullyLoadedThreadIds]) {
      if (!merge.knownConversationIds.has(id)) {
        this.fullyLoadedThreadIds.delete(id);
      }
    }
    for (const id of merge.shellThreadIds) {
      if (merge.knownConversationIds.has(id)) {
        this.fullyLoadedThreadIds.add(id);
      }
    }
    for (const id of [...this.threadLoads.keys()]) {
      if (!merge.knownConversationIds.has(id)) {
        this.threadLoads.delete(id);
      }
    }
  }

  markLoaded(id: string): void {
    this.fullyLoadedThreadIds.add(id);
  }

  forget(id: string): void {
    this.fullyLoadedThreadIds.delete(id);
    this.threadLoads.delete(id);
  }

  loadThread(id: string, force = false): Promise<void> {
    if (!id || (!force && this.fullyLoadedThreadIds.has(id))) {
      return Promise.resolve();
    }
    const existing = this.threadLoads.get(id);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        const messages = await this.options.loadConversationThread(id);
        this.fullyLoadedThreadIds.add(id);
        this.options.onLoadedThread(id, messages);
      } catch (error) {
        this.options.onLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        this.threadLoads.delete(id);
      }
    })();
    this.threadLoads.set(id, promise);
    return promise;
  }

  async loadAllThreads(ids: Iterable<string>): Promise<void> {
    await Promise.all([...ids].map((id) => this.loadThread(id)));
  }
}
