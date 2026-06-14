import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Alert, Box, CircularProgress, Divider, Popover, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useMemo, useState } from "react";
import type { GitGraphCommit } from "../../../client/api/git-panel-api";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { GitRefPickerStore } from "./git-panel-store";

export const GitRefPicker = observer(function GitRefPicker({
  branches,
  commits,
  disabled,
  dirty,
  loading,
  onClose,
  onOpen,
  onSelect,
  t,
  currentBranch,
  currentHash,
  currentTitle,
}: {
  readonly branches: readonly string[];
  readonly commits: readonly GitGraphCommit[];
  readonly disabled: boolean;
  readonly dirty: boolean;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onOpen: () => void;
  readonly onSelect: (ref: string) => void;
  readonly t: I18nApi["t"];
  readonly currentBranch: string;
  readonly currentHash?: string;
  readonly currentTitle?: string;
}) {
  const [store] = useState(() => new GitRefPickerStore());
  const { anchor, setAnchor, query, setQuery } = store;
  const open = Boolean(anchor);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredBranches = useMemo(
    () => branches.filter((branch) => normalizedQuery.length === 0 || branch.toLowerCase().includes(normalizedQuery)),
    [branches, normalizedQuery],
  );
  const filteredCommits = useMemo(
    () =>
      commits
        .filter((commit) => normalizedQuery.length === 0 || commit.shortHash.toLowerCase().includes(normalizedQuery) || commit.hash.toLowerCase().includes(normalizedQuery) || commit.subject.toLowerCase().includes(normalizedQuery))
        .slice(0, 80),
    [commits, normalizedQuery],
  );
  const blocked = dirty || disabled;
  const close = () => {
    setAnchor(null);
    onClose();
  };
  const selectRef = (ref: string) => {
    if (blocked) {
      return;
    }
    close();
    onSelect(ref);
  };

  return (
    <>
      <Tooltip title={dirty ? t("gitSwitchBranchDirty") : t("gitRefPickerOpen")}>
        <Box
          component="button"
          type="button"
          aria-label={t("gitSwitchBranch")}
          disabled={disabled}
          onClick={(event) => {
            if (disabled) {
              return;
            }
            setAnchor(event.currentTarget);
            onOpen();
          }}
          sx={{
            appearance: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 0.4,
            maxWidth: { xs: "100%", sm: 300 },
            minHeight: 24,
            px: 0,
            border: 0,
            borderRadius: 0,
            backgroundColor: "transparent",
            color: open ? "status.running.main" : "text.secondary",
            cursor: disabled ? "default" : "pointer",
            font: "inherit",
            minWidth: 0,
            "&:hover": disabled
              ? undefined
              : {
                  color: "text.primary",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                },
            "&:disabled": {
              opacity: 0.65,
            },
          }}
        >
          <Typography component="span" noWrap sx={{ minWidth: 0, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.82rem", fontWeight: 800 }}>
            {currentBranch}
          </Typography>
          <KeyboardArrowDownIcon sx={{ fontSize: 16, color: "currentColor", flex: "0 0 auto", transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }} />
        </Box>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 20 }}
        slotProps={{
          paper: {
            sx: {
              position: "relative",
              zIndex: (theme) => theme.zIndex.modal + 21,
              mt: 0.75,
              width: 420,
              maxWidth: "calc(100vw - 24px)",
              border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              borderRadius: (theme) => `${theme.custom.radii.lg}px`,
              backgroundColor: (theme) => theme.custom.surfaces.s2,
              backgroundImage: "none",
              opacity: 1,
              boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
              overflow: "hidden",
            },
          },
        }}
      >
        <Stack spacing={1} sx={{ p: 1, backgroundColor: (theme) => theme.custom.surfaces.s2 }}>
          <Stack spacing={0.25} sx={{ px: 0.5, pt: 0.25 }}>
            <Typography sx={{ fontSize: "0.76rem", fontWeight: 800, color: "text.primary" }}>{t("gitRefPickerTitle")}</Typography>
            <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary" }}>
              {currentHash ? `${currentHash} · ${currentTitle || "-"}` : currentTitle || "-"}
            </Typography>
          </Stack>
          <TextField
            autoFocus
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("gitRefPickerSearch")}
            slotProps={{
              htmlInput: { "aria-label": t("gitRefPickerSearch") },
            }}
            sx={{
              "& .MuiInputBase-root": {
                minHeight: 34,
                borderRadius: (theme) => `${theme.custom.radii.md}px`,
                backgroundColor: (theme) => theme.custom.surfaces.s1,
              },
              "& .MuiInputBase-input": {
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: "0.76rem",
              },
            }}
          />
          {dirty && <Alert severity="warning">{t("gitSwitchBranchDirty")}</Alert>}
          <Stack spacing={0.5}>
            <Typography sx={{ px: 0.5, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.66rem", fontWeight: 900, letterSpacing: "0.12em", color: "text.tertiary", textTransform: "uppercase" }}>
              {t("gitRefPickerBranches")}
            </Typography>
            <Stack sx={{ maxHeight: 132, overflow: "auto", borderRadius: (theme) => `${theme.custom.radii.md}px` }}>
              {filteredBranches.length === 0 ? (
                <Typography sx={{ px: 1, py: 0.8, color: "text.secondary", fontSize: "0.78rem" }}>{t("gitNoBranches")}</Typography>
              ) : (
                filteredBranches.map((branch) => (
                  <GitRefPickerRow key={branch} disabled={blocked || branch === currentBranch} active={branch === currentBranch} label={branch} meta={branch === currentBranch ? t("gitRefCurrent") : t("gitBranch")} onClick={() => selectRef(branch)} />
                ))
              )}
            </Stack>
          </Stack>
          <Divider sx={{ borderColor: (theme) => theme.custom.borders.subtle }} />
          <Stack spacing={0.5}>
            <Typography sx={{ px: 0.5, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.66rem", fontWeight: 900, letterSpacing: "0.12em", color: "text.tertiary", textTransform: "uppercase" }}>
              {t("gitRefPickerCommits")}
            </Typography>
            <Stack sx={{ maxHeight: 260, overflow: "auto", borderRadius: (theme) => `${theme.custom.radii.md}px` }}>
              {loading ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1, py: 1, color: "text.secondary" }}>
                  <CircularProgress size={14} />
                  <Typography sx={{ fontSize: "0.78rem" }}>{t("gitTreeLoading")}</Typography>
                </Stack>
              ) : filteredCommits.length === 0 ? (
                <Typography sx={{ px: 1, py: 0.8, color: "text.secondary", fontSize: "0.78rem" }}>{t("gitTreeEmpty")}</Typography>
              ) : (
                filteredCommits.map((commit) => (
                  <GitRefPickerRow
                    key={commit.hash}
                    disabled={blocked || commit.shortHash === currentHash || commit.hash === currentHash}
                    active={commit.shortHash === currentHash || commit.hash === currentHash}
                    label={commit.subject || "-"}
                    meta={`${commit.shortHash} · ${commit.author} · ${commit.date}`}
                    onClick={() => selectRef(commit.hash)}
                  />
                ))
              )}
            </Stack>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
});

function GitRefPickerRow({
  active,
  disabled,
  label,
  meta,
  onClick,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly meta: string;
  readonly onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      disabled={disabled}
      onClick={onClick}
      sx={{
        appearance: "none",
        width: "100%",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.75,
        border: 0,
        borderRadius: (theme) => `${theme.custom.radii.sm}px`,
        backgroundColor: (theme) => (active ? theme.palette.status.running.soft : "transparent"),
        color: "inherit",
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        "&:hover": disabled
          ? undefined
          : {
              backgroundColor: (theme) => theme.custom.surfaces.s3,
            },
        "&:disabled": {
          opacity: active ? 1 : 0.52,
        },
      }}
    >
      <Box sx={{ width: 7, height: 7, borderRadius: 99, backgroundColor: (theme) => (active ? theme.palette.status.running.main : theme.palette.text.secondary), flex: "0 0 auto" }} />
      <Stack sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: "0.78rem", fontWeight: 750, color: "text.primary" }}>
          {label}
        </Typography>
        <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.66rem", color: "text.secondary" }}>
          {meta}
        </Typography>
      </Stack>
    </Box>
  );
}
