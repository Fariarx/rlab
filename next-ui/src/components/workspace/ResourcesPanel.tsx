import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LinkIcon from "@mui/icons-material/Link";
import { Box, ButtonBase, CircularProgress, Collapse, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/I18nProvider";
import { loadConversationResources } from "../../client/api/workspace-api";
import type { ConversationResource, ResourceKind } from "../../lib/conversation-resources";
import { localFileUrl } from "../../lib/external-url";
import { normalizeClockLabel } from "../../lib/time-format";
import { EmptyState, ImageLightbox } from "../ui";
import { useWorkspaceUi } from "../../lib/workspace-ui";
import { ImageBannerStore, ResourcesPanelStore } from "./stores/workspace-local-stores";

function KindIcon({ kind }: { readonly kind: ConversationResource["kind"] }) {
  const Icon = kind === "image" ? ImageOutlinedIcon : kind === "link" ? LinkIcon : DescriptionOutlinedIcon;
  return (
    <Box sx={{ flex: "0 0 auto", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: (theme) => `${theme.custom.radii.sm}px`, backgroundColor: (theme) => theme.custom.surfaces.s3, color: "text.secondary" }}>
      <Icon sx={{ fontSize: 15 }} />
    </Box>
  );
}


/** Small banner thumbnail for image cards, with a graceful fallback. */
const ImageBanner = observer(function ImageBanner({ resource }: { readonly resource: ConversationResource }) {
  const [store] = useState(() => new ImageBannerStore());
  const { failed, setFailed } = store;
  return (
    <Box sx={{ width: "100%", aspectRatio: "16 / 9", flex: "0 0 auto", borderRadius: (theme) => `${theme.custom.radii.sm}px`, overflow: "hidden", backgroundColor: (theme) => theme.custom.surfaces.s3, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {failed ? (
        <ImageOutlinedIcon sx={{ fontSize: 22, color: "text.tertiary" }} />
      ) : (
        <Box component="img" src={localFileUrl(resource.url)} alt={resource.label} loading="lazy" onError={() => setFailed(true)} sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      )}
    </Box>
  );
});

/** A compact resource card with uniform height. Image cards lead with a
 *  thumbnail; all cards show a kind icon + label. */
function ResourceCard({ resource, onClick }: { readonly resource: ConversationResource; readonly onClick?: () => void }) {
  const showSecondary = resource.url !== resource.label;
  return (
    <Stack
      spacing={0.75}
      onClick={onClick}
      sx={{
        p: 1,
        minWidth: 0,
        height: "100%",
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
        <KindIcon kind={resource.kind} />
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
            {normalizeClockLabel(resource.time)}
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

/** A collapsible section per resource type. The parent owns expansion so only
 *  one resource category is open at a time. */
const ResourceGroup = observer(function ResourceGroup({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Box sx={{ borderRadius: (theme) => `${theme.custom.radii.md}px`, backgroundColor: (theme) => theme.custom.surfaces.s1, overflow: "hidden" }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        sx={{ width: "100%", display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 0.875, textAlign: "left", "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3 } }}
      >
        <Typography sx={{ flex: 1, minWidth: 0, fontFamily: (theme) => theme.custom.fonts.mono, fontWeight: 700, fontSize: "0.76rem", color: "text.primary" }}>
          {title}
        </Typography>
        <Typography component="span" sx={{ flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" }}>
          {count}
        </Typography>
        <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", transition: "transform 180ms ease", transform: open ? "rotate(180deg)" : "none" }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.25, pb: 1.25, pt: 0.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
});

const RESOURCE_GROUPS: ReadonlyArray<{ readonly kind: ResourceKind; readonly labelKey: TranslationKey }> = [
  { kind: "image", labelKey: "resourcesImages" },
  { kind: "link", labelKey: "resourcesLinks" },
  { kind: "file", labelKey: "resourcesFiles" },
];

/**
 * Resources tab — files, links, and images referenced in the full persisted
 * thread, grouped into collapsible sections by type (newest first within each).
 * Images open a viewer, links open in the browser Preview, files download or
 * jump to Git.
 */
export const ResourcesPanel = observer(function ResourcesPanel({
  conversationId,
  resourceRevision,
  bottomInset = 0,
}: {
  readonly conversationId: string | undefined;
  readonly resourceRevision?: number;
  readonly bottomInset?: number;
}) {
  const { t } = useI18n();
  const ui = useWorkspaceUi();
  const [store] = useState(() => new ResourcesPanelStore());
  const {
    clearResources,
    failResourceLoad,
    finishResourceLoad,
    lightbox,
    openResourceKind,
    resources,
    resourcesLoadError,
    resourcesLoading,
    setLightbox,
    startResourceLoad,
    syncResourceKinds,
    toggleResourceKind,
  } = store;
  const revisionKey = typeof resourceRevision === "number" && Number.isFinite(resourceRevision) ? String(resourceRevision) : "unversioned";
  const resourceGroups = useMemo(
    () =>
      RESOURCE_GROUPS.map(({ kind, labelKey }) => ({
        kind,
        labelKey,
        items: resources.filter((resource) => resource.kind === kind).reverse(),
      })).filter((group) => group.items.length > 0),
    [resources],
  );

  useEffect(() => {
    syncResourceKinds(resourceGroups.map((group) => group.kind));
  }, [resourceGroups, syncResourceKinds]);

  useEffect(() => {
    if (!conversationId) {
      clearResources();
      return;
    }
    const controller = new AbortController();
    startResourceLoad(conversationId, revisionKey);
    void loadConversationResources(conversationId, { signal: controller.signal })
      .then((loadedResources) => {
        finishResourceLoad(conversationId, revisionKey, loadedResources);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        failResourceLoad(conversationId, revisionKey, error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [clearResources, conversationId, failResourceLoad, finishResourceLoad, revisionKey, startResourceLoad]);

  const isAbsolutePath = (value: string): boolean => value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);

  const onResourceClick = (resource: ConversationResource): (() => void) | undefined => {
    if (resource.kind === "image") {
      return () => setLightbox(resource);
    }
    if (resource.kind === "link") {
      return ui ? () => ui.openPreview(resource.url) : undefined;
    }
    // An absolute path (a pasted attachment / produced artifact) downloads through
    // the local-file endpoint; a repo-relative path jumps to the Git file viewer.
    if (isAbsolutePath(resource.url)) {
      return () => window.open(`${localFileUrl(resource.url)}&download=1`, "_blank", "noopener,noreferrer");
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

      {resourcesLoading && resources.length === 0 ? (
        <Stack sx={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", px: 3 }}>
          <CircularProgress size={22} />
        </Stack>
      ) : resourcesLoadError && resources.length === 0 ? (
        <Stack sx={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", px: 3 }}>
          <Typography role="alert" sx={{ maxWidth: 420, textAlign: "center", fontSize: "0.78rem", color: "error.main" }}>
            {resourcesLoadError}
          </Typography>
        </Stack>
      ) : resourceGroups.length === 0 ? (
        <Stack sx={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", px: 3 }}>
          <EmptyState icon={<InsertDriveFileOutlinedIcon />} title={t("resourcesEmptyTitle")} description={t("resourcesEmptyDescription")} />
        </Stack>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1.5, pt: 1.5, pb: `${16 + bottomInset}px` }}>
          <Stack spacing={1}>
            {resourceGroups.map(({ kind, labelKey, items }) => {
              return (
                <ResourceGroup key={kind} title={t(labelKey)} count={items.length} open={openResourceKind === kind} onToggle={() => toggleResourceKind(kind)}>
                  <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", alignItems: "stretch" }}>
                    {items.map((resource) => (
                      <ResourceCard key={resource.id} resource={resource} onClick={onResourceClick(resource)} />
                    ))}
                  </Box>
                </ResourceGroup>
              );
            })}
          </Stack>
        </Box>
      )}

      <ImageLightbox src={lightbox?.url ?? null} label={lightbox?.label} onClose={() => setLightbox(null)} />
    </Stack>
  );
});
