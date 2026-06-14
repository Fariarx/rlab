import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import { CircularProgress, Stack, Typography } from "@mui/material";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { IconButton } from "../../ui";
import type { TerminalStatus } from "./terminal-view-model";

export function TerminalHeader({
  cwd,
  onRestart,
  onStop,
  status,
  t,
}: {
  readonly cwd: string;
  readonly onRestart: () => void;
  readonly onStop: () => void;
  readonly status: TerminalStatus;
  readonly t: I18nApi["t"];
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        flex: "0 0 auto",
        px: 1.25,
        py: 0.8,
        borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: "#0d1318",
      }}
    >
      <TerminalIcon sx={{ fontSize: 17, color: "text.secondary" }} />
      <Typography noWrap sx={{ minWidth: 0, flex: 1, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem", color: "text.tertiary" }}>
        {cwd}
      </Typography>
      {status.connecting && <CircularProgress size={13} />}
      {status.error && (
        <Typography noWrap sx={{ maxWidth: "40%", fontSize: "0.72rem", color: (theme) => theme.palette.status.error.main }}>
          {status.error}
        </Typography>
      )}
      {status.exitCode !== null && status.exitCode !== 0 && (
        <Typography sx={{ fontSize: "0.72rem", color: (theme) => theme.palette.status.error.main }}>{t("terminalExitCode", { code: status.exitCode })}</Typography>
      )}
      {status.running && (
        <IconButton aria-label={t("stopTerminalCommand")} tone="danger" onClick={onStop} sx={{ width: 28, height: 28, flex: "0 0 auto" }}>
          <StopCircleOutlinedIcon sx={{ fontSize: 17 }} />
        </IconButton>
      )}
      {!status.running && !status.connecting && (
        <IconButton aria-label={status.exitCode === null ? t("openTerminalCommand") : t("restartTerminalCommand")} onClick={onRestart} sx={{ width: 28, height: 28, flex: "0 0 auto" }}>
          {status.exitCode === null ? <PlayArrowRoundedIcon sx={{ fontSize: 17 }} /> : <ReplayRoundedIcon sx={{ fontSize: 17 }} />}
        </IconButton>
      )}
    </Stack>
  );
}
