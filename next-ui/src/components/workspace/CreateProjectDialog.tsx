import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CheckIcon from "@mui/icons-material/Check";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import { Alert, Box, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, Stack, TextField, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { type KeyboardEvent, useEffect, useState } from "react";
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
  const theme = useTheme();
  // Fill the screen on phones — a tiny floating popover was unusable there.
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The dialog flips between the form and an in-app folder browser (the OS dialog
  // can't open on a headless server), rendered inline so it works on mobile.
  const [mode, setMode] = useState<"form" | "browse">("form");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [listingBusy, setListingBusy] = useState(false);
  // The editable path shown in the browser; type + Enter to jump anywhere.
  const [pathInput, setPathInput] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setPath("");
      setError(null);
      setBusy(false);
      setMode("form");
      setListing(null);
      setPathInput("");
    }
  }, [open]);

  const loadDirectory = async (target?: string) => {
    setListingBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/list-directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target ? { path: target } : {}),
      });
      const payload = (await response.json()) as DirectoryListing & { error?: string };
      if (!response.ok) {
        // Stay in the browser and surface the error so the user can fix the path
        // inline (manual entry is the fallback when navigation hits a bad path).
        setError(payload.error ?? t("folderPickerUnavailable"));
        return;
      }
      setListing({ path: payload.path, parent: payload.parent ?? null, entries: payload.entries ?? [] });
      setPathInput(payload.path);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setListingBusy(false);
    }
  };

  const openBrowser = () => {
    setError(null);
    setMode("browse");
    void loadDirectory(path.trim() || undefined);
  };

  const goToTypedPath = () => {
    void loadDirectory(pathInput.trim() || undefined);
  };

  const goUp = () => {
    if (listing?.parent) {
      void loadDirectory(listing.parent);
    }
  };

  const chooseCurrentFolder = () => {
    if (listing) {
      setPath(listing.path);
      setName((current) => current.trim() || pathName(listing.path));
    }
    setMode("form");
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
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      {mode === "form" ? (
        <>
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
        </>
      ) : (
        <>
          <DialogTitle sx={{ fontSize: "1rem", fontWeight: 700, pb: 1 }}>{t("selectFolderTitle")}</DialogTitle>
          {/* Up one level (just the ↑ glyph) + editable, navigable path. */}
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", px: 2, pb: 1 }}>
            <Tooltip title={t("folderUp")}>
              <span>
                <IconButton aria-label={t("folderUp")} disabled={!listing?.parent || listingBusy} onClick={goUp} edge="start">
                  <ArrowUpwardIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <TextField
              size="small"
              fullWidth
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  goToTypedPath();
                }
              }}
              placeholder="/home/user"
              slotProps={{ input: { sx: { fontFamily: (th) => th.custom.fonts.mono, fontSize: "0.78rem" } } }}
            />
          </Stack>
          {/* 2px bar gives an immediate "loading" beat when a row is tapped. */}
          <Box sx={{ height: 2 }}>{listingBusy && <LinearProgress sx={{ height: 2 }} />}</Box>
          <DialogContent sx={{ p: 0, ...(fullScreen ? {} : { height: 320 }) }}>
            {error && (
              <Alert severity="error" sx={{ m: 1.5, py: 0.25, fontSize: "0.78rem", "& .MuiAlert-message": { py: 0.5 } }}>
                {error}
              </Alert>
            )}
            <List
              disablePadding
              sx={{ opacity: listingBusy ? 0.45 : 1, transition: "opacity 120ms ease", pointerEvents: listingBusy ? "none" : "auto" }}
            >
              {listing?.entries.map((entry) => (
                <ListItemButton key={entry.path} sx={{ minHeight: 48, px: 2 }} onClick={() => void loadDirectory(entry.path)}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <FolderOutlinedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                  </ListItemIcon>
                  <ListItemText slotProps={{ primary: { noWrap: true, sx: { fontSize: "0.85rem" } } }}>{entry.name}</ListItemText>
                </ListItemButton>
              ))}
              {listing && listing.entries.length === 0 && !listingBusy && (
                <Typography sx={{ px: 2, py: 2, fontSize: "0.8rem", color: "text.tertiary" }}>{t("folderEmpty")}</Typography>
              )}
            </List>
          </DialogContent>
          <DialogActions sx={{ px: 2.5, pb: 2, pt: 1 }}>
            <Button variant="text" onClick={() => setMode("form")}>
              {t("cancel")}
            </Button>
            <Button variant="contained" startIcon={<CheckIcon sx={{ fontSize: 16 }} />} disabled={!listing} onClick={chooseCurrentFolder}>
              {t("useThisFolder")}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
