import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PublicIcon from "@mui/icons-material/Public";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Box, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { normalizeExternalUrl } from "../../lib/external-url";
import { EmptyState, IconButton } from "../ui";

/**
 * In-app web preview. Renders a chosen URL in a sandboxed iframe with a compact
 * chrome (address, reload, open-external, close). Many sites refuse to be framed
 * (X-Frame-Options / CSP), so a persistent hint keeps the external escape hatch
 * in reach rather than pretending every page will load.
 */
export function PreviewPanel({ url, onClose }: { readonly url: string | null; readonly onClose: () => void }) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Bare-domain links (`vitest.dev/api`) must be upgraded to an absolute URL,
  // otherwise the iframe resolves them relative to the app and loads itself.
  const src = useMemo(() => (url ? normalizeExternalUrl(url) ?? url : null), [url]);

  // Reset the reload counter whenever the URL changes so a fresh page starts clean.
  useEffect(() => {
    setReloadKey(0);
  }, [url]);

  const reload = () => {
    setReloadKey((key) => key + 1);
  };

  const openExternal = () => {
    if (src) {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: (theme) => theme.custom.surfaces.s1 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 1.5,
          py: 0.75,
          flex: "0 0 auto",
          borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        }}
      >
        <PublicIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
        <Typography component="span" noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.76rem", color: "text.secondary", flex: "1 1 0", minWidth: 0 }}>
          {src ?? t("previewEmptyDescription")}
        </Typography>
        <Tooltip title={t("refresh")}>
          <span>
            <IconButton aria-label={t("refresh")} disabled={!src} onClick={reload}>
              <RefreshIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("openExternalLink")}>
          <span>
            <IconButton aria-label={t("openExternalLink")} disabled={!src} onClick={openExternal}>
              <OpenInNewIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("previewClose")}>
          <IconButton aria-label={t("previewClose")} onClick={onClose}>
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      {src ? (
        <Box sx={{ flex: 1, minHeight: 0, position: "relative", backgroundColor: "#fff" }}>
          <Box
            key={`${src}-${reloadKey}`}
            ref={iframeRef}
            component="iframe"
            src={src}
            title={t("previewTab")}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            sx={{ width: "100%", height: "100%", border: 0, display: "block" }}
          />
          <Typography
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              px: 1.5,
              py: 0.5,
              fontFamily: (theme) => theme.custom.fonts.mono,
              fontSize: "0.62rem",
              color: "text.secondary",
              backgroundColor: (theme) => theme.custom.surfaces.s1,
              borderTop: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              pointerEvents: "none",
              textAlign: "center",
            }}
          >
            {t("previewEmbedHint")}
          </Typography>
        </Box>
      ) : (
        <Stack sx={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", px: 3 }}>
          <EmptyState icon={<PublicIcon />} title={t("previewEmptyTitle")} description={t("previewEmptyDescription")} />
        </Stack>
      )}
    </Stack>
  );
}
