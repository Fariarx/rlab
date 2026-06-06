import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { Alert, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button } from "../ui";
import { type CreateProjectInput } from "./use-workspace";

interface CreateProjectDialogProps {
  readonly open: boolean;
  readonly defaultProfile: CreateProjectInput["profile"];
  readonly onClose: () => void;
  readonly onCreate: (input: CreateProjectInput) => void;
}

interface FolderPayload {
  readonly path?: string | null;
  readonly name?: string;
  readonly error?: string;
}

function pathName(path: string): string {
  const segments = path.replace(/[\\/]+$/g, "").split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

async function readFolderPayload(response: Response): Promise<FolderPayload> {
  const payload = (await response.json()) as unknown;
  return typeof payload === "object" && payload !== null ? (payload as FolderPayload) : {};
}

export function CreateProjectDialog({ open, defaultProfile, onClose, onCreate }: CreateProjectDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setPath("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const pickFolder = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/folder-picker", { method: "POST" });
      const payload = await readFolderPayload(response);
      if (!response.ok) {
        setError(payload.error ?? t("folderPickerUnavailable"));
        return;
      }
      if (!payload.path) {
        setError(t("folderPickerCanceled"));
        return;
      }
      setPath(payload.path);
      setName((current) => current.trim() || payload.name || pathName(payload.path ?? ""));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const trimmedPath = path.trim();
    const trimmedName = name.trim();
    if (!trimmedPath) {
      setError(t("projectPathRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/folder-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmedPath }),
      });
      const payload = await readFolderPayload(response);
      if (!response.ok || !payload.path) {
        setError(payload.error ?? t("projectPathInvalid"));
        return;
      }
      const resolvedName = trimmedName || payload.name || pathName(payload.path);
      if (!resolvedName.trim()) {
        setError(t("projectNameRequired"));
        return;
      }
      onCreate({ name: resolvedName, path: payload.path, profile: defaultProfile });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("createProject")}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label={t("projectName")} value={name} onChange={(event) => setName(event.target.value)} fullWidth />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField label={t("projectPath")} value={path} onChange={(event) => setPath(event.target.value)} fullWidth />
            <Button variant="subtle" onClick={pickFolder} disabled={busy} startIcon={<FolderOpenIcon sx={{ fontSize: 16 }} />} sx={{ flex: "0 0 auto" }}>
              {t("browseFolder")}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2 }}>
        <Button variant="text" disabled={busy} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="contained" disabled={busy} onClick={create}>
          {t("create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
