import { useEffect, useState } from "react";
import { loadProjectFiles } from "../../../client/api/workspace-page-api";
import type { ToastOptions } from "../../ui";

export interface UseProjectFilesOptions {
  readonly cwd: string | undefined;
  readonly toast: (options: ToastOptions) => string;
}

export function useProjectFiles({ cwd, toast }: UseProjectFilesOptions): readonly string[] {
  const [files, setFiles] = useState<readonly string[]>([]);

  useEffect(() => {
    let alive = true;
    if (!cwd) {
      setFiles([]);
      return;
    }

    loadProjectFiles(cwd)
      .then((nextFiles) => {
        if (alive) {
          setFiles(nextFiles);
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setFiles([]);
          toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        }
      });

    return () => {
      alive = false;
    };
  }, [cwd, toast]);

  return files;
}
