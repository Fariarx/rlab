import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LinkIcon from "@mui/icons-material/Link";
import { Box, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { type ConversationResource, collectResources } from "../../lib/conversation-resources";
import type { ChatMessage } from "../agent";
import { EmptyState } from "../ui";
import { ImageLightbox } from "./ImageLightbox";
import { useWorkspaceUi } from "./workspace-ui";

function KindIcon({ kind }: { readonly kind: ConversationResource["kind"] }) {
  const Icon = kind === "image" ? ImageOutlinedIcon : kind === "link" ? LinkIcon : DescriptionOutlinedIcon;
  return (
    <Box sx={{ flex: "0 0 auto", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: (theme) => `${theme.custom.radii.sm}px`, backgroundColor: (theme) => theme.custom.surfaces.s3, color: "text.secondary" }}>
      <Icon sx={{ fontSize: 15 }} />
    </Box>
  );
}

/** Small banner thumbnail for image cards, with a graceful fallback. */
function ImageBanner({ resource }: { readonly resource: ConversationResource }) {
  const [failed, setFailed] = useState(false);
  return (
    <Box sx={{ width: "100%", aspectRatio: "16 / 9", borderRadius: (theme) => `${theme.custom.radii.sm}px`, overflow: "hidden", backgroundColor: (theme) => theme.custom.surfaces.s3, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {failed ? (
        <ImageOutlinedIcon sx={{ fontSize: 22, color: "text.tertiary" }} />
      ) : (
        <Box component="img" src={resource.url} alt={resource.label} loading="lazy" onError={() => setFailed(true)} sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      )}
    </Box>
  );
}

/** A compact resource card: image cards lead with a thumbnail, link/file cards
 *  with a kind icon. Each shows the time it was first mentioned. */
function ResourceCard({ resource, onClick }: { readonly resource: ConversationResource; readonly onClick?: () => void }) {
  const showSecondary = resource.url !== resource.label;
  return (
    <Stack
      spacing={0.75}
      onClick={onClick}
      sx={{
        p: 1,
        minWidth: 0,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        cursor: onClick ? "pointer" : "default",
        transition: "background-color 120ms ease, border-color 120ms ease",
        "&:hover": onClick ? { backgroundColor: (theme) => theme.custom.surfaces.s3, borderColor: (theme) => theme.custom.borders.strong } : undefined,
      }}
    >
      {resource.kind === "image" && <ImageBanner resource={resource} />}
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
        {resource.kind !== "image" && <KindIcon kind={resource.kind} />}
        <Typography
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: "0.78rem",
            color: "text.primary",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: 1.35,
          }}
        >
          {resource.label}
        </Typography>
        {resource.time && (
          <Typography sx={{ flex: "0 0 auto", alignSelf: "flex-start", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.62rem", color: "text.tertiary" }}>
            {resource.time}
          </Typography>
        )}
      </Stack>
      {showSecondary && (
        <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary", minWidth: 0 }}>
          {resource.url}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * Resources tab — every file, link, and image referenced in the open thread, as
 * a grid of compact cards ordered by when each was first mentioned (not grouped
 * by type). Images open a viewer, links open in the browser Preview, files jump
 * to Git.
 */
export function ResourcesPanel({ messages, bottomInset = 0 }: { readonly messages: readonly ChatMessage[]; readonly bottomInset?: number }) {
  const { t } = useI18n();
  const ui = useWorkspaceUi();
  const [lightbox, setLightbox] = useState<ConversationResource | null>(null);
  const resources = useMemo(() => collectResources(messages), [messages]);

  const onResourceClick = (resource: ConversationResource): (() => void) | undefined => {
    if (resource.kind === "image") {
      return () => setLightbox(resource);
    }
    if (resource.kind === "link") {
      return ui ? () => ui.openPreview(resource.url) : undefined;
    }
    return ui ? () => ui.openGitFile(resource.url) : undefined;
  };

  return (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: (theme) => theme.custom.surfaces.s1 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 1.5, py: 0.75, flex: "0 0 auto", borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}` }}
      >
        <InsertDriveFileOutlinedIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
        <Typography component="span" noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontWeight: 700, fontSize: "0.82rem" }}>
          {t("resourcesTab")}
        </Typography>
      </Stack>

      {resources.length === 0 ? (
        <Stack sx={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", px: 3 }}>
          <EmptyState icon={<InsertDriveFileOutlinedIcon />} title={t("resourcesEmptyTitle")} description={t("resourcesEmptyDescription")} />
        </Stack>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1.5, pt: 1.5, pb: `${16 + bottomInset}px` }}>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", alignItems: "start" }}>
            {resources.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} onClick={onResourceClick(resource)} />
            ))}
          </Box>
        </Box>
      )}

      <ImageLightbox src={lightbox?.url ?? null} label={lightbox?.label} onClose={() => setLightbox(null)} />
    </Stack>
  );
}
