import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CheckIcon from "@mui/icons-material/Check";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import { Alert, Box, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Popover, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { type KeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton } from "../ui";
import type { CreateProjectInput } from "./use-workspace";

interface DirectoryListing {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: ReadonlyArray<{ readonly name: string; readonly path: string }>;
}

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
  // In-app folder browser (the OS dialog can't open on a headless server).
  const [browserAnchor, setBrowserAnchor] = useState<HTMLElement | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [listingBusy, setListingBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setPath("");
      setError(null);
      setBusy(false);
      setBrowserAnchor(null);
      setListing(null);
    }
  }, [open]);

  const loadDirectory = async (target?: string) => {
    setListingBusy(true);
    try {
      const response = await fetch("/api/list-directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target ? { path: target } : {}),
      });
      const payload = (await response.json()) as DirectoryListing & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? t("folderPickerUnavailable"));
        return;
      }
      setListing({ path: payload.path, parent: payload.parent ?? null, entries: payload.entries ?? [] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setListingBusy(false);
    }
  };

  const openBrowser = (event: ReactMouseEvent<HTMLElement>) => {
    setError(null);
    setBrowserAnchor(event.currentTarget);
    void loadDirectory(path.trim() || undefined);
  };

  const chooseCurrentFolder = () => {
    if (listing) {
      setPath(listing.path);
      setName((current) => current.trim() || pathName(listing.path));
    }
    setBrowserAnchor(null);
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

  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !busy) {
      event.preventDefault();
      void create();
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: "1rem", fontWeight: 700, pb: 1 }}>{t("createProject")}</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          {error && (
            <Alert severity="error" sx={{ py: 0.25, fontSize: "0.78rem", "& .MuiAlert-message": { py: 0.5 } }}>
              {error}
            </Alert>
          )}
          <TextField
            size="small"
            autoFocus
            label={t("projectName")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={submitOnEnter}
            fullWidth
          />
          <TextField
            size="small"
            label={t("projectPath")}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="/home/user/project"
            helperText={t("projectPathHint")}
            fullWidth
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={t("browseFolder")}>
                      <IconButton aria-label={t("browseFolder")} onClick={openBrowser} disabled={busy} edge="end">
                        <FolderOpenIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
            }}
          />
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

      <Popover
        open={Boolean(browserAnchor)}
        anchorEl={browserAnchor}
        onClose={() => setBrowserAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: "90vw", overflow: "hidden" } } }}
      >
        <Stack sx={{ maxHeight: 360 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1.5, py: 1, borderBottom: (th) => `1px solid ${th.custom.borders.subtle}` }}>
            <FolderOutlinedIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
            <Typography noWrap title={listing?.path} sx={{ flex: 1, minWidth: 0, fontFamily: (th) => th.custom.fonts.mono, fontSize: "0.72rem", color: "text.secondary" }}>
              {listing?.path ?? "…"}
            </Typography>
            {listingBusy && <CircularProgress size={14} thickness={5} />}
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <List dense disablePadding>
              {listing?.parent && (
                <ListItemButton onClick={() => void loadDirectory(listing.parent ?? undefined)}>
                  <ListItemIcon sx={{ minWidth: 30 }}>
                    <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                  </ListItemIcon>
                  <ListItemText slotProps={{ primary: { sx: { fontSize: "0.8rem" } } }}>..</ListItemText>
                </ListItemButton>
              )}
              {listing?.entries.map((entry) => (
                <ListItemButton key={entry.path} onClick={() => void loadDirectory(entry.path)}>
                  <ListItemIcon sx={{ minWidth: 30 }}>
                    <FolderOutlinedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  </ListItemIcon>
                  <ListItemText slotProps={{ primary: { noWrap: true, sx: { fontSize: "0.8rem" } } }}>{entry.name}</ListItemText>
                </ListItemButton>
              ))}
              {listing && listing.entries.length === 0 && !listing.parent && (
                <Typography sx={{ px: 1.5, py: 1.5, fontSize: "0.78rem", color: "text.tertiary" }}>{t("folderEmpty")}</Typography>
              )}
            </List>
          </Box>
          <Box sx={{ px: 1.5, py: 1, borderTop: (th) => `1px solid ${th.custom.borders.subtle}` }}>
            <Button fullWidth variant="contained" size="small" startIcon={<CheckIcon sx={{ fontSize: 16 }} />} disabled={!listing} onClick={chooseCurrentFolder}>
              {t("useThisFolder")}
            </Button>
          </Box>
        </Stack>
      </Popover>
    </Dialog>
  );
}
