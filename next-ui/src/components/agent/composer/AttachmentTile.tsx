import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { ComposerTag } from "./ComposerTag";

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
  const sx = { fontSize: 15, flex: "0 0 auto", color: (t: Theme) => t.palette.status.info.main } as const;
  if (mime?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(name)) {
    return <ImageOutlinedIcon sx={sx} />;
  }
  if (CODE_RE.test(name)) {
    return <CodeOutlinedIcon sx={sx} />;
  }
  if (mime?.startsWith("text/") || /\.(txt|md|log|csv)$/i.test(name)) {
    return <DescriptionOutlinedIcon sx={sx} />;
  }
  return <InsertDriveFileOutlinedIcon sx={sx} />;
}

export interface AttachmentTileProps {
  readonly name: string;
  readonly mime?: string;
  readonly sizeBytes?: number;
  /** Accepted for call-site compatibility; tags show a type icon, not a preview. */
  readonly previewSrc?: string;
  readonly onOpen?: () => void;
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
}

/**
 * A single attachment shown as a compact tag: a file-type icon + name (+ size),
 * with an optional remove button (composer) — instead of a large square tile.
 * Shared by the composer and sent messages so both read the same.
 */
export function AttachmentTile({ name, mime, sizeBytes, onOpen, onRemove, removeLabel }: AttachmentTileProps) {
  const size = formatBytes(sizeBytes);
  return (
    <ComposerTag
      testId="attachment-tag"
      icon={<FileGlyph name={name} mime={mime} />}
      label={name}
      clickAriaLabel={name}
      onClick={onOpen ? () => onOpen() : undefined}
      onRemove={onRemove}
      removeLabel={removeLabel}
      accessory={
        size ? (
          <Typography component="span" noWrap sx={{ flex: "0 0 auto", fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>
            {size}
          </Typography>
        ) : undefined
      }
    />
  );
}
