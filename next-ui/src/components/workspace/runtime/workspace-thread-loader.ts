import type { ChatMessage } from "../../agent";
import type { RemoteWorkspaceShellMerge } from "../models/workspace-server-sync-model";

export interface WorkspaceThreadPage {
  readonly messages: readonly ChatMessage[];
  readonly hasMoreBefore: boolean;
  readonly nextBefore?: number;
}

export interface WorkspaceThreadLoaderOptions {
  readonly loadConversationThreadPage: (id: string, before?: number) => Promise<WorkspaceThreadPage>;
  readonly loadConversationThreadFull: (id: string) => Promise<readonly ChatMessage[]>;
  readonly onLoadedThread: (id: string, messages: readonly ChatMessage[]) => void;
  readonly onLoadedOlderThread: (id: string, messages: readonly ChatMessage[]) => void;
  readonly onLoadError: (message: string) => void;
}

export class WorkspaceThreadLoader {
  private readonly loadedThreadIds = new Set<string>();

  private readonly fullyLoadedThreadIds = new Set<string>();

  private readonly threadLoads = new Map<string, Promise<void>>();

  private readonly olderThreadLoads = new Map<string, Promise<void>>();

  private readonly fullThreadLoads = new Map<string, Promise<void>>();

  private readonly nextBeforeByThread = new Map<string, number>();

  constructor(private readonly options: WorkspaceThreadLoaderOptions) {}

  resetLoadedThreads(threadIds: Iterable<string>): void {
    this.loadedThreadIds.clear();
    this.fullyLoadedThreadIds.clear();
    this.threadLoads.clear();
    this.olderThreadLoads.clear();
    this.fullThreadLoads.clear();
    this.nextBeforeByThread.clear();
    for (const id of threadIds) {
      this.loadedThreadIds.add(id);
      this.fullyLoadedThreadIds.add(id);
    }
  }

  reconcileRemoteShell(merge: RemoteWorkspaceShellMerge): void {
    for (const id of [...this.loadedThreadIds]) {
      if (!merge.knownConversationIds.has(id)) {
        this.loadedThreadIds.delete(id);
      }
    }
    for (const id of [...this.fullyLoadedThreadIds]) {
      if (!merge.knownConversationIds.has(id)) {
        this.fullyLoadedThreadIds.delete(id);
      }
    }
    for (const id of merge.shellThreadIds) {
      if (merge.knownConversationIds.has(id)) {
        this.loadedThreadIds.add(id);
        this.fullyLoadedThreadIds.add(id);
      }
    }
    for (const id of [...this.nextBeforeByThread.keys()]) {
      if (!merge.knownConversationIds.has(id) || merge.shellThreadIds.has(id)) {
        this.nextBeforeByThread.delete(id);
      }
    }
    for (const id of [...this.threadLoads.keys()]) {
      if (!merge.knownConversationIds.has(id)) {
        this.threadLoads.delete(id);
      }
    }
    for (const id of [...this.olderThreadLoads.keys()]) {
      if (!merge.knownConversationIds.has(id)) {
        this.olderThreadLoads.delete(id);
      }
    }
    for (const id of [...this.fullThreadLoads.keys()]) {
      if (!merge.knownConversationIds.has(id)) {
        this.fullThreadLoads.delete(id);
      }
    }
  }

  markLoaded(id: string): void {
    this.loadedThreadIds.add(id);
    this.fullyLoadedThreadIds.add(id);
    this.nextBeforeByThread.delete(id);
  }

  isLoaded(id: string): boolean {
    return this.loadedThreadIds.has(id);
  }

  isFullyLoaded(id: string): boolean {
    return this.fullyLoadedThreadIds.has(id);
  }

  hasOlderMessages(id: string): boolean {
    return this.loadedThreadIds.has(id) && !this.fullyLoadedThreadIds.has(id) && this.nextBeforeByThread.has(id);
  }

  forget(id: string): void {
    this.loadedThreadIds.delete(id);
    this.fullyLoadedThreadIds.delete(id);
    this.threadLoads.delete(id);
    this.olderThreadLoads.delete(id);
    this.fullThreadLoads.delete(id);
    this.nextBeforeByThread.delete(id);
  }

  loadThread(id: string, force = false): Promise<void> {
    if (!id || (!force && this.loadedThreadIds.has(id))) {
      return Promise.resolve();
    }
    if (this.fullyLoadedThreadIds.has(id)) {
      return this.loadFullThread(id, force);
    }
    const existing = this.threadLoads.get(id);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        const page = await this.options.loadConversationThreadPage(id);
        if (this.fullyLoadedThreadIds.has(id) && !force) {
          return;
        }
        this.loadedThreadIds.add(id);
        if (page.hasMoreBefore && page.nextBefore !== undefined) {
          this.nextBeforeByThread.set(id, page.nextBefore);
          this.fullyLoadedThreadIds.delete(id);
        } else {
          this.nextBeforeByThread.delete(id);
          this.fullyLoadedThreadIds.add(id);
        }
        this.options.onLoadedThread(id, page.messages);
      } catch (error) {
        this.options.onLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        this.threadLoads.delete(id);
      }
    })();
    this.threadLoads.set(id, promise);
    return promise;
  }

  loadOlderThread(id: string): Promise<void> {
    const before = this.nextBeforeByThread.get(id);
    if (!id || before === undefined || this.fullyLoadedThreadIds.has(id)) {
      return Promise.resolve();
    }
    const existing = this.olderThreadLoads.get(id);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        const page = await this.options.loadConversationThreadPage(id, before);
        if (this.fullyLoadedThreadIds.has(id)) {
          return;
        }
        this.loadedThreadIds.add(id);
        if (page.hasMoreBefore && page.nextBefore !== undefined) {
          this.nextBeforeByThread.set(id, page.nextBefore);
        } else {
          this.nextBeforeByThread.delete(id);
          this.fullyLoadedThreadIds.add(id);
        }
        this.options.onLoadedOlderThread(id, page.messages);
      } catch (error) {
        this.options.onLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        this.olderThreadLoads.delete(id);
      }
    })();
    this.olderThreadLoads.set(id, promise);
    return promise;
  }

  loadFullThread(id: string, force = false): Promise<void> {
    if (!id || (!force && this.fullyLoadedThreadIds.has(id))) {
      return Promise.resolve();
    }
    const existing = this.fullThreadLoads.get(id);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        const messages = await this.options.loadConversationThreadFull(id);
        this.loadedThreadIds.add(id);
        this.fullyLoadedThreadIds.add(id);
        this.nextBeforeByThread.delete(id);
        this.options.onLoadedThread(id, messages);
      } catch (error) {
        this.options.onLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        this.fullThreadLoads.delete(id);
      }
    })();
    this.fullThreadLoads.set(id, promise);
    return promise;
  }
}
