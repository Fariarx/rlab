import { useCallback, useEffect, useState } from "react";
import { listDirectories, loadFolderInfo } from "../../../client/api/directory-api";
import type { I18nApi } from "../../../i18n/I18nProvider";
import type { CreateProjectInput } from "../use-workspace";
import { CreateProjectDialogStore } from "../stores/workspace-local-stores";

function pathName(path: string): string {
  const segments = path.replace(/[\\/]+$/g, "").split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

export interface CreateProjectDialogController {
  readonly store: CreateProjectDialogStore;
  readonly loadDirectory: (target?: string) => Promise<void>;
  readonly openBrowser: () => void;
  readonly goToTypedPath: () => void;
  readonly goUp: () => void;
  readonly chooseCurrentFolder: () => void;
  readonly create: () => Promise<void>;
}

export function useCreateProjectDialogController({
  open,
  defaultProfile,
  onClose,
  onCreate,
  t,
}: {
  readonly open: boolean;
  readonly defaultProfile: CreateProjectInput["profile"];
  readonly onClose: () => void;
  readonly onCreate: (input: CreateProjectInput) => void;
  readonly t: I18nApi["t"];
}): CreateProjectDialogController {
  const [store] = useState(() => new CreateProjectDialogStore());

  const loadDirectory = useCallback(async (target?: string) => {
    store.setListingBusy(true);
    store.setError(null);
    try {
      const payload = await listDirectories(target);
      store.setListing({ path: payload.path, parent: payload.parent ?? null, entries: payload.entries ?? [] });
      store.setPathInput(payload.path);
    } catch (caught) {
      store.setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      store.setListingBusy(false);
    }
  }, [store]);

  useEffect(() => {
    if (!open) {
      return;
    }
    store.reset();
    void loadDirectory();
  }, [loadDirectory, open, store]);

  const openBrowser = useCallback(() => {
    store.setError(null);
    store.setBrowseCancelAction("form");
    store.setMode("browse");
    void loadDirectory(store.path.trim() || undefined);
  }, [loadDirectory, store]);

  const goToTypedPath = useCallback(() => {
    void loadDirectory(store.pathInput.trim() || undefined);
  }, [loadDirectory, store]);

  const goUp = useCallback(() => {
    if (store.listing?.parent) {
      void loadDirectory(store.listing.parent);
    }
  }, [loadDirectory, store]);

  const chooseCurrentFolder = useCallback(() => {
    if (store.listing) {
      store.setPath(store.listing.path);
      store.setName((current) => current.trim() || pathName(store.listing?.path ?? ""));
    }
    store.setMode("form");
  }, [store]);

  const create = useCallback(async () => {
    const trimmedPath = store.path.trim();
    const trimmedName = store.name.trim();
    if (!trimmedPath) {
      store.setError(t("projectPathRequired"));
      return;
    }
    store.setBusy(true);
    store.setError(null);
    try {
      const payload = await loadFolderInfo(trimmedPath);
      const resolvedName = trimmedName || payload.name || pathName(payload.path);
      if (!resolvedName.trim()) {
        store.setError(t("projectNameRequired"));
        return;
      }
      onCreate({ name: resolvedName, path: payload.path, profile: defaultProfile });
      onClose();
    } catch (caught) {
      store.setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      store.setBusy(false);
    }
  }, [defaultProfile, onClose, onCreate, store, t]);

  return {
    store,
    loadDirectory,
    openBrowser,
    goToTypedPath,
    goUp,
    chooseCurrentFolder,
    create,
  };
}
