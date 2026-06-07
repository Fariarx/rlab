import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LinkIcon from "@mui/icons-material/Link";
import { Box, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { type ConversationResource, collectResources } from "../../lib/conversation-resources";
import { type ChatMessage } from "../agent";
import { EmptyState } from "../ui";
import { ImageLightbox } from "./ImageLightbox";
import { useWorkspaceUi } from "./workspace-ui";

function SectionHeading({ children }: { readonly children: string }) {
  return (
    <Typography variant="microLabel" sx={{ color: "text.secondary", px: 0.5 }}>
      {children}
    </Typography>
  );
}

function ResourceRow({
  icon,
  primary,
  secondary,
  onClick,
}: {
  readonly icon: React.ReactNode;
  readonly primary: string;
  readonly secondary?: string;
  readonly onClick?: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      onClick={onClick}
      sx={{
        alignItems: "center",
        px: 1.25,
        py: 0.875,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        cursor: onClick ? "pointer" : "default",
        transition: "background-color 120ms ease",
        "&:hover": onClick ? { backgroundColor: (theme) => theme.custom.surfaces.s3 } : undefined,
      }}
    >
      <Box sx={{ flex: "0 0 auto", display: "flex", color: "text.secondary" }}>{icon}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontSize: "0.82rem", color: "text.primary" }}>
          {primary}
        </Typography>
        {secondary && (
          <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary" }}>
            {secondary}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function ImageThumb({ resource, onOpen }: { readonly resource: ConversationResource; readonly onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <Box
      onClick={onOpen}
      sx={{
        position: "relative",
        aspectRatio: "1 / 1",
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        overflow: "hidden",
        cursor: "pointer",
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        "&:hover": { borderColor: (theme) => theme.palette.status.running.main },
      }}
    >
      {failed ? (
        <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center", color: "text.tertiary" }}>
          <ImageOutlinedIcon sx={{ fontSize: 22 }} />
        </Stack>
      ) : (
        <Box component="img" src={resource.url} alt={resource.label} loading="lazy" onError={() => setFailed(true)} sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      )}
    </Box>
  );
}

/**
 * Resources tab — the files, links, and images referenced in the open thread,
 * in the order they first appeared. Shows the resources themselves (images are
 * viewable, links open in Preview, files jump to Git), not the agent's actions.
 */
export function ResourcesPanel({ messages, bottomInset = 0 }: { readonly messages: readonly ChatMessage[]; readonly bottomInset?: number }) {
  const { t } = useI18n();
  const ui = useWorkspaceUi();
  const [lightbox, setLightbox] = useState<ConversationResource | null>(null);
  const resources = useMemo(() => collectResources(messages), [messages]);

  const images = resources.filter((resource) => resource.kind === "image");
  const links = resources.filter((resource) => resource.kind === "link");
  const files = resources.filter((resource) => resource.kind === "file");
  const isEmpty = resources.length === 0;

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

      {isEmpty ? (
        <Stack sx={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", px: 3 }}>
          <EmptyState icon={<InsertDriveFileOutlinedIcon />} title={t("resourcesEmptyTitle")} description={t("resourcesEmptyDescription")} />
        </Stack>
      ) : (
        <Stack spacing={2.5} sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1.5, pt: 2, pb: `${16 + bottomInset}px` }}>
          {images.length > 0 && (
            <Stack spacing={1}>
              <SectionHeading>{t("resourcesImages")}</SectionHeading>
              <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
                {images.map((resource) => (
                  <ImageThumb key={resource.id} resource={resource} onOpen={() => setLightbox(resource)} />
                ))}
              </Box>
            </Stack>
          )}

          {links.length > 0 && (
            <Stack spacing={1}>
              <SectionHeading>{t("resourcesLinks")}</SectionHeading>
              <Stack spacing={0.75}>
                {links.map((resource) => (
                  <ResourceRow
                    key={resource.id}
                    icon={<LinkIcon sx={{ fontSize: 16 }} />}
                    primary={resource.label}
                    secondary={resource.url !== resource.label ? resource.url : undefined}
                    onClick={ui ? () => ui.openPreview(resource.url) : undefined}
                  />
                ))}
              </Stack>
            </Stack>
          )}

          {files.length > 0 && (
            <Stack spacing={1}>
              <SectionHeading>{t("resourcesFiles")}</SectionHeading>
              <Stack spacing={0.75}>
                {files.map((resource) => (
                  <ResourceRow
                    key={resource.id}
                    icon={<DescriptionOutlinedIcon sx={{ fontSize: 16 }} />}
                    primary={resource.label}
                    secondary={resource.url !== resource.label ? resource.url : undefined}
                    onClick={ui ? () => ui.openGitFile(resource.url) : undefined}
                  />
                ))}
              </Stack>
            </Stack>
          )}
        </Stack>
      )}

      <ImageLightbox src={lightbox?.url ?? null} label={lightbox?.label} onClose={() => setLightbox(null)} />
    </Stack>
  );
}
