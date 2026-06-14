import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import type { I18nApi } from "../../../i18n/I18nProvider";
import type { ComposerLimitLine } from "./composer-limits-model";

function MeterRow({ label, value, percent }: { readonly label: string; readonly value: string; readonly percent?: number }) {
  const clamped = typeof percent === "number" ? Math.max(0, Math.min(100, percent)) : null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <Typography sx={{ fontSize: "0.72rem", color: "text.secondary" }}>{label}</Typography>
        <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.72rem", color: "text.primary" }}>{value}</Typography>
      </Stack>
      {clamped !== null && (
        <Box sx={{ height: 5, borderRadius: (t) => `${t.custom.radii.pill}px`, backgroundColor: (t) => t.custom.surfaces.s4, overflow: "hidden" }}>
          <Box
            sx={{
              height: "100%",
              width: `${clamped}%`,
              borderRadius: (t) => `${t.custom.radii.pill}px`,
              transition: "width 220ms ease",
              backgroundColor: (t) => (clamped >= 90 ? t.palette.status.error.main : clamped >= 70 ? t.palette.status.warn.main : t.palette.status.running.main),
            }}
          />
        </Box>
      )}
    </Box>
  );
}

export function ComposerLimitsPanel({
  emptyMessage,
  limitLines,
  loading,
  onToggle,
  open,
  refreshError,
  refreshing,
  t,
  updatePosition,
}: {
  readonly emptyMessage: string;
  readonly limitLines: readonly ComposerLimitLine[];
  readonly loading: boolean;
  readonly onToggle: () => void;
  readonly open: boolean;
  readonly refreshError: string | null;
  readonly refreshing: boolean;
  readonly t: I18nApi["t"];
  readonly updatePosition: () => void;
}) {
  return (
    <Box sx={{ px: 2, py: 0.75, cursor: "default" }} onClick={(event) => event.stopPropagation()}>
      <Collapse
        in={open}
        timeout={120}
        unmountOnExit={false}
        onEnter={updatePosition}
        onEntering={updatePosition}
        onEntered={updatePosition}
        onExit={updatePosition}
        onExiting={updatePosition}
        onExited={updatePosition}
      >
        <Box id="composer-agent-limits" sx={{ pb: 0.75 }}>
          {limitLines.length > 0 ? (
            <Stack spacing={1}>
              {limitLines.map((line) => (
                <MeterRow key={line.id} label={line.label} value={line.value} percent={line.percent} />
              ))}
            </Stack>
          ) : (
            <Typography sx={{ fontSize: "0.72rem", color: "text.tertiary" }}>{loading ? "..." : emptyMessage}</Typography>
          )}
          {refreshError ? (
            <Typography sx={{ mt: 0.75, fontSize: "0.72rem", color: (theme) => theme.palette.status.error.main }}>
              {refreshError}
            </Typography>
          ) : null}
        </Box>
      </Collapse>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        aria-controls="composer-agent-limits"
        onClick={onToggle}
        sx={{
          width: "100%",
          border: 0,
          p: 0,
          m: 0,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          cursor: "pointer",
          color: "inherit",
          backgroundColor: "transparent",
          textAlign: "left",
          font: "inherit",
        }}
      >
        <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block", flex: 1, minWidth: 0 }}>
          {t("limitsLabel")}
        </Typography>
        {refreshing ? <Typography sx={{ fontSize: "0.72rem", color: "text.tertiary", fontFamily: (theme) => theme.custom.fonts.mono }}>...</Typography> : null}
        <KeyboardArrowDownRoundedIcon
          sx={{
            fontSize: 16,
            color: "text.secondary",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 140ms ease",
          }}
        />
      </Box>
    </Box>
  );
}
