import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { Box, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { IconButton } from "../../ui";
import { ImageFailedStore } from "../stores/agent-local-stores";

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : "";
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cc|cs|php|sh|bash|sql|json|ya?ml|toml|xml|html|css|scss)$/i;

function FileGlyph({ name, mime }: { readonly name: string; readonly mime?: string }) {
  if (mime?.startsWith("image/")) {
    return <ImageOutlinedIcon sx={{ fontSize: 24, color: "text.secondary" }} />;
  }
  if (CODE_RE.test(name)) {
    return <CodeOutlinedIcon sx={{ fontSize: 24, color: "text.secondary" }} />;
  }
  if (mime?.startsWith("text/") || /\.(txt|md|log|csv)$/i.test(name)) {
    return <DescriptionOutlinedIcon sx={{ fontSize: 24, color: "text.secondary" }} />;
  }
  return <InsertDriveFileOutlinedIcon sx={{ fontSize: 24, color: "text.secondary" }} />;
}

export interface AttachmentTileProps {
  readonly name: string;
  readonly mime?: string;
  readonly sizeBytes?: number;
  /** Resolved URL for an image preview; when set the tile shows the picture. */
  readonly previewSrc?: string;
  readonly onOpen?: () => void;
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
}

/**
 * A compact square tile for a single attachment — image preview or a file glyph
 * with its extension, plus a name + size caption. Shared by the composer (with a
 * remove button) and sent messages (read-only), so both look identical.
 */
export const AttachmentTile = observer(function AttachmentTile({ name, mime, sizeBytes, previewSrc, onOpen, onRemove, removeLabel }: AttachmentTileProps) {
  const [store] = useState(() => new ImageFailedStore());
  const { failed: imgFailed, setFailed: setImgFailed } = store;
  const ext = extOf(name);
  const size = formatBytes(sizeBytes);
  const showImage = Boolean(previewSrc) && !imgFailed;
  return (
    <Box
      sx={{
        position: "relative",
        width: 76,
        height: 76,
        flex: "0 0 auto",
        pointerEvents: "auto",
        borderRadius: (t) => `${t.custom.radii.md}px`,
        overflow: "hidden",
        border: (t) => `1px solid ${t.custom.borders.strong}`,
        backgroundColor: (t) => t.custom.surfaces.s2,
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
      }}
    >
      <Box
        component={onOpen ? "button" : "div"}
        type={onOpen ? "button" : undefined}
        onClick={onOpen}
        aria-label={onOpen ? name : undefined}
        sx={{
          display: "grid",
          gridTemplateRows: "1fr auto",
          width: "100%",
          height: "100%",
          p: 0,
          border: 0,
          textAlign: "left",
          cursor: onOpen ? "pointer" : "default",
          backgroundColor: "transparent",
        }}
      >
        {showImage ? (
          <>
            <Box component="img" src={previewSrc} alt={name} loading="lazy" onError={() => setImgFailed(true)} sx={{ gridRow: "1 / -1", width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            {(ext || mime) && (
              <Typography
                noWrap
                sx={{
                  gridRow: "2",
                  justifySelf: "start",
                  minWidth: 0,
                  maxWidth: "calc(100% - 8px)",
                  ml: 0.375,
                  mb: 0.375,
                  px: 0.5,
                  py: 0.125,
                  alignSelf: "end",
                  borderRadius: (t) => `${t.custom.radii.sm}px`,
                  fontFamily: (t) => t.custom.fonts.mono,
                  fontSize: "0.56rem",
                  fontWeight: 800,
                  color: "text.primary",
                  backgroundColor: "rgba(0, 0, 0, 0.62)",
                  backdropFilter: "blur(4px)",
                }}
              >
                {ext || "IMG"}
              </Typography>
            )}
          </>
        ) : (
          <>
            <Box sx={{ minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5, backgroundColor: (t) => t.custom.surfaces.s3 }}>
              <FileGlyph name={name} mime={mime} />
              {ext && (
                <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.04em", color: "text.secondary" }}>
                  {ext}
                </Typography>
              )}
            </Box>
            <Box sx={{ px: 0.5, py: 0.25, minWidth: 0, backgroundColor: (t) => t.custom.surfaces.s2 }}>
              <Typography noWrap sx={{ fontSize: "0.6rem", lineHeight: 1.15, fontWeight: 600, color: "text.primary" }}>
                {name}
              </Typography>
              {size && (
                <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.52rem", lineHeight: 1.15, color: "text.secondary" }}>
                  {size}
                </Typography>
              )}
            </Box>
          </>
        )}
      </Box>
      {onRemove && (
        <IconButton
          aria-label={removeLabel ?? ""}
          onClick={onRemove}
          sx={{
            // Subtle by default; a background only appears on hover (no red).
            position: "absolute",
            top: 3,
            right: 3,
            p: 0.25,
            color: "text.secondary",
            backgroundColor: "transparent",
            transition: "background-color 120ms ease, color 120ms ease",
            "&:hover": { color: "text.primary", backgroundColor: (t) => t.custom.surfaces.s1 },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 13 }} />
        </IconButton>
      )}
    </Box>
  );
});
