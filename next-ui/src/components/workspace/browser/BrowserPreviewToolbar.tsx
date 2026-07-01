import AdsClickIcon from "@mui/icons-material/AdsClick";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import RateReviewIcon from "@mui/icons-material/RateReview";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Box, CircularProgress, IconButton, InputBase, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactElement } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { browserPreviewDefaultUrl, type EventStreamStatus, type PreviewMode } from "../../../lib/browser-preview-model";

const tooltippedControlSx = { display: "inline-flex", flex: "0 0 auto" } as const;

const visuallyHiddenSx = {
  position: "absolute",
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

function controlTooltip(title: string, child: ReactElement) {
  return (
    <Tooltip title={title} enterDelay={0} arrow>
      <Box component="span" sx={tooltippedControlSx}>
        {child}
      </Box>
    </Tooltip>
  );
}

export function BrowserPreviewToolbar({
  canGoBack,
  canGoForward,
  eventStreamStatus,
  liveUrl,
  mirrorStatusText,
  mirrorSyncing,
  mode,
  onBack,
  onForward,
  onModeChange,
  onOpen,
  onRefresh,
  onSyncMirror,
  onUrlChange,
  playwrightStatusLabel,
  t,
  url,
}: {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly eventStreamStatus: EventStreamStatus;
  readonly liveUrl: string | null;
  readonly mirrorStatusText: string;
  readonly mirrorSyncing: boolean;
  readonly mode: PreviewMode;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onModeChange: (event: ReactMouseEvent<HTMLElement>, nextMode: PreviewMode | null) => void;
  readonly onOpen: (event: FormEvent<HTMLFormElement>) => void;
  readonly onRefresh: () => void;
  readonly onSyncMirror: () => void;
  readonly onUrlChange: (url: string) => void;
  readonly playwrightStatusLabel: string;
  readonly t: I18nApi["t"];
  readonly url: string;
}) {
  return (
    <Box
      component="form"
      data-testid="browser-preview-browser-bar"
      onSubmit={onOpen}
      sx={{
        flex: "0 0 auto",
        height: 46,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 1,
        borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        // On narrow phones the fixed controls + URL field exceed the width.
        // Let the bar scroll horizontally so controls stay reachable.
        overflowX: "auto",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      {controlTooltip(
        t("browserPreviewBack"),
        <IconButton data-testid="browser-preview-back-button" aria-label={t("browserPreviewBack")} size="small" disabled={!canGoBack} onClick={onBack}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>,
      )}
      {controlTooltip(
        t("browserPreviewForward"),
        <IconButton data-testid="browser-preview-forward-button" aria-label={t("browserPreviewForward")} size="small" disabled={!canGoForward} onClick={onForward}>
          <ArrowForwardIcon fontSize="small" />
        </IconButton>,
      )}
      {controlTooltip(
        t("browserPreviewRefresh"),
        <IconButton data-testid="browser-preview-refresh-button" aria-label={t("browserPreviewRefresh")} size="small" disabled={!liveUrl || mirrorSyncing} onClick={onRefresh}>
          <RefreshIcon fontSize="small" />
        </IconButton>,
      )}
      <InputBase
        value={url}
        onChange={(event) => onUrlChange(event.target.value)}
        placeholder={browserPreviewDefaultUrl}
        inputProps={{ "aria-label": t("browserPreviewUrlLabel"), "data-testid": "browser-preview-url-input" }}
        sx={{
          flex: "1 1 auto",
          // Guarantee a usable width on phones; the toolbar scrolls horizontally
          // for the surrounding controls instead of starving the URL field.
          minWidth: { xs: 168, sm: 220 },
          height: 30,
          maxHeight: 30,
          px: 1.25,
          boxSizing: "border-box",
          alignItems: "center",
          borderRadius: 999,
          backgroundColor: (theme) => theme.custom.surfaces.s1,
          color: "text.primary",
          fontFamily: (theme) => theme.custom.fonts.mono,
          fontSize: "0.86rem",
          lineHeight: 1,
          "& input": { height: "100%", boxSizing: "border-box", textAlign: "center", p: 0 },
        }}
      />
      {controlTooltip(
        t("browserPreviewOpen"),
        <IconButton data-testid="browser-preview-open-button" aria-label={t("browserPreviewOpen")} type="submit" size="small" disabled={mirrorSyncing}>
          {mirrorSyncing ? <CircularProgress color="inherit" size={18} /> : <OpenInBrowserIcon fontSize="small" />}
        </IconButton>,
      )}
      <Tooltip title={`${t("browserPreviewSyncMirror")} · ${playwrightStatusLabel}`} enterDelay={0} arrow>
        <Box
          component="button"
          type="button"
          data-testid="browser-preview-sync-button"
          aria-label={`${t("browserPreviewSyncMirror")}: ${playwrightStatusLabel}`}
          aria-disabled={mirrorSyncing || !liveUrl ? "true" : undefined}
          onClick={(event) => {
            event.preventDefault();
            if (mirrorSyncing || !liveUrl) {
              return;
            }
            onSyncMirror();
          }}
          sx={{
            flex: "0 0 auto",
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: 0.45,
            height: 24,
            px: 0.75,
            borderRadius: 999,
            border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => theme.custom.surfaces.s1,
            color: "text.secondary",
            cursor: mirrorSyncing || !liveUrl ? "default" : "pointer",
            fontFamily: (theme) => theme.custom.fonts.mono,
            fontSize: "0.68rem",
            fontWeight: 900,
            letterSpacing: 0,
            lineHeight: 1,
            opacity: mirrorSyncing || !liveUrl ? 0.72 : 1,
            outline: 0,
            "&:hover": {
              borderColor: mirrorSyncing || !liveUrl ? undefined : (theme) => theme.custom.borders.strong,
              backgroundColor: mirrorSyncing || !liveUrl ? undefined : (theme) => theme.custom.surfaces.s2,
            },
            "&:focus-visible": {
              boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
            },
          }}
        >
          <Box component="span" aria-hidden="true" sx={{ color: "text.primary", fontWeight: 900 }}>
            pw
          </Box>
          <Box component="span" aria-hidden="true" sx={{ color: eventStreamStatus === "error" ? "error.main" : "text.secondary", fontWeight: 900 }}>
            {eventStreamStatus === "connected" ? t("browserPreviewEventsLiveShort") : eventStreamStatus === "error" ? t("browserPreviewEventsErrorShort") : t("browserPreviewEventsIdleShort")}
          </Box>
          <Box component="span" sx={visuallyHiddenSx}>
            {mirrorStatusText}
          </Box>
        </Box>
      </Tooltip>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={onModeChange}
        aria-label={t("browserPreviewMode")}
        sx={{
          flex: "0 0 auto",
          height: 30,
          "& .MuiToggleButton-root": { width: 30, p: 0, borderColor: (theme) => theme.custom.borders.subtle },
        }}
      >
        {controlTooltip(
          t("browserPreviewInteractMode"),
          <ToggleButton data-testid="browser-preview-mode-interact" value="interact" aria-label={t("browserPreviewInteractMode")}>
            <OpenInBrowserIcon sx={{ fontSize: 16 }} />
          </ToggleButton>,
        )}
        {controlTooltip(
          t("browserPreviewAnnotateMode"),
          <ToggleButton data-testid="browser-preview-mode-annotate" value="annotate" aria-label={t("browserPreviewAnnotateMode")}>
            <RateReviewIcon sx={{ fontSize: 16 }} />
          </ToggleButton>,
        )}
        {controlTooltip(
          t("browserPreviewComponentMode"),
          <ToggleButton data-testid="browser-preview-mode-component" value="component" aria-label={t("browserPreviewComponentMode")}>
            <AdsClickIcon sx={{ fontSize: 16 }} />
          </ToggleButton>,
        )}
      </ToggleButtonGroup>
    </Box>
  );
}
