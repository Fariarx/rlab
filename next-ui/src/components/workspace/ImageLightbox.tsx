import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Backdrop, Box, Stack, Typography } from "@mui/material";
import { useI18n } from "../../i18n/I18nProvider";
import { IconButton } from "../ui";

/** Full-screen image viewer opened from the Resources tab thumbnails. */
export function ImageLightbox({ src, label, onClose }: { readonly src: string | null; readonly label?: string; readonly onClose: () => void }) {
  const { t } = useI18n();

  return (
    <Backdrop open={src != null} onClick={onClose} sx={{ zIndex: (theme) => theme.zIndex.modal, backgroundColor: "rgba(8, 11, 14, 0.88)", backdropFilter: "blur(2px)" }}>
      {src != null && (
        <Stack sx={{ width: "100%", height: "100%", p: 3, minHeight: 0 }} onClick={(event) => event.stopPropagation()}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", flex: "0 0 auto", pb: 1.5 }}>
            <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.78rem", color: "text.secondary", minWidth: 0 }}>
              {label ?? src}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flex: "0 0 auto" }}>
              <IconButton aria-label={t("openExternalLink")} onClick={() => window.open(src, "_blank", "noopener,noreferrer")}>
                <OpenInNewIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <IconButton aria-label={t("previewClose")} onClick={onClose}>
                <CloseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Stack>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Box component="img" src={src} alt={label ?? ""} sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: (theme) => `${theme.custom.radii.md}px` }} />
          </Box>
        </Stack>
      )}
    </Backdrop>
  );
}
