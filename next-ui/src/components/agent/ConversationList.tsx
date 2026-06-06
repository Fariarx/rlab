import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import { Box, Collapse, InputBase, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { IconButton, StatusDot } from "../ui";
import { AgentMonogram } from "./AgentMonogram";
import { rise } from "./anim";
import { messageToPlainText } from "./message-actions";
import { type ChatMessage, conversationStatusKey as statusToKey, type ConversationStatus, type ConversationSummary, type Project } from "./types";
import { formatCostUsd, formatTokenUsage } from "./usage-cost";

export interface ConversationActions {
  readonly onRename: (id: string, title: string) => void;
  readonly onTogglePin: (id: string) => void;
  readonly onArchive: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

export function conversationMatches(conversation: ConversationSummary, query: string, threads: Readonly<Record<string, readonly ChatMessage[]>>): boolean {
  const threadText = (threads[conversation.id] ?? []).map(messageToPlainText).join("\n");
  const searchable = `${conversation.title}\n${conversation.snippet}\n${threadText}`.toLowerCase();
  return searchable.includes(query);
}

// Status dots on the avatar are noise for resting conversations, so only the
// actionable states (running / waiting / error) get one. Idle (gray) and done
// (green) render the bare monogram.
const STATUSES_WITH_DOT: ReadonlySet<ConversationStatus> = new Set<ConversationStatus>(["running", "waiting", "error"]);

function ConversationAvatar({ conversation }: { readonly conversation: ConversationSummary }) {
  const { conversationStatus } = useI18n();
  if (!STATUSES_WITH_DOT.has(conversation.status)) {
    return <AgentMonogram agent={conversation.agent} size={28} />;
  }
  return (
    <Box sx={{ position: "relative", flex: "0 0 auto" }}>
      <AgentMonogram agent={conversation.agent} size={28} />
      <Tooltip title={conversationStatus(conversation.status)}>
        <Box sx={{ position: "absolute", right: -3, bottom: -3, borderRadius: "50%", display: "flex", p: "2px", backgroundColor: (t) => t.custom.surfaces.s1 }}>
          <StatusDot status={statusToKey[conversation.status]} label={conversationStatus(conversation.status)} pulse={conversation.status === "running"} size="sm" />
        </Box>
      </Tooltip>
    </Box>
  );
}

function ConversationRow({
  conversation,
  active,
  delay,
  onSelect,
  onMove,
  registerRowRef,
  actions,
}: {
  readonly conversation: ConversationSummary;
  readonly active: boolean;
  readonly delay: number;
  readonly onSelect: (id: string) => void;
  readonly onMove: (id: string, offset: -1 | 1) => void;
  readonly registerRowRef: (id: string, element: HTMLDivElement | null) => void;
  readonly actions: ConversationActions;
}) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const menuOpen = Boolean(menuAnchor);
  const { t } = useI18n();

  // Focus (and select) the rename field once it mounts. Doing it in an effect —
  // rather than relying on `autoFocus` — wins the race against the closing menu
  // restoring focus to its (now unmounted) trigger, which previously blurred the
  // field immediately and made rename look like a no-op.
  useEffect(() => {
    if (!editing) {
      return;
    }
    const handle = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(handle);
  }, [editing]);

  const openMenu = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => setMenuAnchor(null);

  const startRename = () => {
    setDraft(conversation.title);
    setEditing(true);
    closeMenu();
  };
  const commitRename = () => {
    if (editing) {
      setEditing(false);
      actions.onRename(conversation.id, draft);
    }
  };
  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      setDraft(conversation.title);
    }
  };
  const onRowKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || e.target !== e.currentTarget) {
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(conversation.id);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onMove(conversation.id, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onMove(conversation.id, -1);
    }
  };

  return (
    <Stack
      ref={(element: HTMLDivElement | null) => registerRowRef(conversation.id, element)}
      role="option"
      aria-label={conversation.title}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      direction="row"
      spacing={1.25}
      onClick={() => !editing && onSelect(conversation.id)}
      onKeyDown={onRowKey}
      sx={{
        position: "relative",
        alignItems: "center",
        px: 1.25,
        py: 1,
        borderRadius: (t) => `${t.custom.radii.md}px`,
        cursor: editing ? "default" : "pointer",
        backgroundColor: (t) => (active ? t.custom.surfaces.s3 : "transparent"),
        // Accent rendered as an inset shadow (not an element) so it never shifts
        // the content or collides with the avatar.
        boxShadow: (t) => (active ? `inset 3px 0 0 0 ${t.palette.status.running.main}` : "none"),
        transition: "background-color 140ms ease, box-shadow 140ms ease",
        "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 },
        "&:hover .row-more": { opacity: 1 },
        // Fade the date out whenever the ⋯ overlay is showing (hover or open
        // menu) so the date never peeks out from under it. The date stays in the
        // layout, just transparent.
        "&:hover .row-date": { opacity: 0 },
        ...(menuOpen && { "& .row-date": { opacity: 0 } }),
        "&:focus-visible": {
          outline: (t) => `2px solid ${t.custom.borders.focus}`,
          outlineOffset: "-2px",
        },
        ...rise(delay),
      }}
    >
      <ConversationAvatar conversation={conversation} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <InputBase
            inputRef={renameInputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onEditKey}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            sx={{
              width: "100%",
              fontSize: "0.82rem",
              fontWeight: 600,
              px: 0.75,
              py: 0.25,
              borderRadius: (t) => `${t.custom.radii.sm}px`,
              backgroundColor: (t) => t.custom.surfaces.s1,
            }}
          />
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
            <Typography noWrap sx={{ fontSize: "0.82rem", fontWeight: conversation.unread ? 700 : 500, color: "text.primary" }}>
              {conversation.title}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flex: "0 0 auto" }}>
              {conversation.unread && <Box sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: (t) => t.palette.status.running.main }} />}
              {conversation.costUsd !== undefined && (
                <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: (t) => t.palette.status.info.main }}>
                  {formatCostUsd(conversation.costUsd)}
                </Typography>
              )}
              {conversation.usage !== undefined && (
                <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>
                  {formatTokenUsage(conversation.usage)}
                </Typography>
              )}
              <Typography className="row-date" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary", transition: "opacity 120ms ease" }}>{conversation.time}</Typography>
            </Stack>
          </Stack>
        )}
        {!editing && (
          <Typography noWrap sx={{ fontSize: "0.74rem", color: "text.secondary", mt: 0.25 }}>
            {conversation.snippet}
          </Typography>
        )}
      </Box>

      {/* Overlay (after the date) so it never compresses the card content, and
          only appears on hover / when its menu is open. */}
      {!editing && (
        <Box
          className="row-more"
          sx={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "flex",
            borderRadius: (t) => `${t.custom.radii.sm}px`,
            backgroundColor: (t) => t.custom.surfaces.s3,
            opacity: menuOpen ? 1 : 0,
            transition: "opacity 120ms ease",
            "&:hover": { backgroundColor: (t) => t.custom.surfaces.s4 },
          }}
        >
          <IconButton aria-label={t("conversationActions")} onClick={openMenu} sx={{ p: 0.25 }}>
            <MoreHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      )}

      <Menu anchorEl={menuAnchor} open={menuOpen} onClose={closeMenu} onClick={(e) => e.stopPropagation()} disableRestoreFocus>
        <MenuItem onClick={startRename}>{t("rename")}</MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            actions.onTogglePin(conversation.id);
          }}
        >
          {conversation.pinned ? t("unpin") : t("pin")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            actions.onArchive(conversation.id);
          }}
        >
          {t("archive")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            actions.onDelete(conversation.id);
          }}
          sx={{ color: (t) => t.palette.status.error.main }}
        >
          {t("delete")}
        </MenuItem>
      </Menu>
    </Stack>
  );
}

/** A collapsible sidebar group (pinned / project / chats). Headers carry the
 *  count always; the unread + running indicators surface only while the group
 *  is collapsed (when expanded the rows themselves convey that). */
function ConversationGroup({
  idBase,
  label,
  conversations,
  selectedId,
  baseDelay,
  collapsedIcon,
  expandedIcon,
  onSelect,
  onMove,
  registerRowRef,
  actions,
}: {
  readonly idBase: string;
  readonly label: string;
  readonly conversations: readonly ConversationSummary[];
  readonly selectedId: string | null;
  readonly baseDelay: number;
  readonly collapsedIcon: ReactNode;
  readonly expandedIcon: ReactNode;
  readonly onSelect: (id: string) => void;
  readonly onMove: (id: string, offset: -1 | 1) => void;
  readonly registerRowRef: (id: string, element: HTMLDivElement | null) => void;
  readonly actions: ConversationActions;
}) {
  const [open, setOpen] = useState(true);
  const { t } = useI18n();
  const runningCount = conversations.filter((c) => c.status === "running").length;
  const hasUnread = conversations.some((c) => c.unread);
  const panelId = `${idBase}-conversations`;

  const toggleOpen = () => setOpen((value) => !value);
  const onHeaderKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }
    e.preventDefault();
    toggleOpen();
  };

  return (
    <Box>
      <Stack
        role="button"
        aria-expanded={open}
        aria-controls={panelId}
        tabIndex={0}
        direction="row"
        spacing={0.75}
        onClick={toggleOpen}
        onKeyDown={onHeaderKey}
        sx={{
          alignItems: "center",
          px: 1,
          py: 0.75,
          cursor: "pointer",
          borderRadius: (t) => `${t.custom.radii.sm}px`,
          "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 },
          "&:focus-visible": { outline: (t) => `2px solid ${t.custom.borders.focus}`, outlineOffset: "-2px" },
        }}
      >
        <Box sx={{ display: "flex", color: "text.secondary" }}>{open ? expandedIcon : collapsedIcon}</Box>
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }} noWrap>
          {label}
        </Typography>
        {/* Collapsed only: a single indicator — running status takes priority,
            otherwise the unread marker. Never both, and no count badge. */}
        {!open &&
          (runningCount > 0 ? (
            <StatusDot status="running" label={t("runningCount", { count: runningCount })} />
          ) : hasUnread ? (
            <Box role="img" aria-label={t("unread")} sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: (t) => t.palette.status.running.main }} />
          ) : null)}
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack id={panelId} spacing={0.25} sx={{ mt: 0.25, mb: 0.75 }}>
          {conversations.map((conversation, index) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === selectedId}
              delay={baseDelay + index * 50}
              onSelect={onSelect}
              onMove={onMove}
              registerRowRef={registerRowRef}
              actions={actions}
            />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

export function ConversationList({
  projects,
  chats,
  selectedId,
  onSelect,
  actions,
}: {
  readonly projects: readonly Project[];
  readonly chats: readonly ConversationSummary[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly actions: ConversationActions;
}) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const { t } = useI18n();

  // Pinned conversations are lifted into a top group and removed from their
  // original project / chats list.
  const pinned = useMemo(
    () => [...chats, ...projects.flatMap((project) => project.conversations)].filter((c) => c.pinned),
    [projects, chats],
  );
  const visibleProjects = useMemo(
    () => projects.map((project) => ({ ...project, conversations: project.conversations.filter((c) => !c.pinned) })),
    [projects],
  );
  const visibleChats = useMemo(() => chats.filter((c) => !c.pinned), [chats]);

  const empty = projects.length === 0 && chats.length === 0;
  // Pinned first, then projects, then chats — flattened for arrow-key navigation.
  const visibleConversationIds = useMemo(
    () => [...pinned.map((c) => c.id), ...visibleProjects.flatMap((project) => project.conversations.map((c) => c.id)), ...visibleChats.map((c) => c.id)],
    [pinned, visibleProjects, visibleChats],
  );
  const registerRowRef = (id: string, element: HTMLDivElement | null) => {
    if (element) {
      rowRefs.current.set(id, element);
    } else {
      rowRefs.current.delete(id);
    }
  };
  const focusConversation = (id: string) => {
    const focus = () => rowRefs.current.get(id)?.focus();
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focus);
    } else {
      window.setTimeout(focus, 0);
    }
  };
  const moveConversation = (id: string, offset: -1 | 1) => {
    const currentIndex = visibleConversationIds.indexOf(id);
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), visibleConversationIds.length - 1);
    const nextId = visibleConversationIds[nextIndex];
    if (!nextId || nextId === id) {
      return;
    }
    onSelect(nextId);
    focusConversation(nextId);
  };

  // One unified, full-width scroll list (scrollbar flush at the right edge):
  // pinned group, then project folder-accordions, then a chats group. No mode
  // toggle, no inline search (search is a popup from the sidebar header).
  return (
    <Box
      role="listbox"
      aria-label={t("conversationList")}
      data-testid="conversation-list-virtual-list"
      data-virtualized="false"
      // `scrollbar-gutter: stable both-edges` reserves equal gutters on both
      // sides so the left/right inset stays even whether or not the scrollbar
      // is showing.
      sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable both-edges", px: 0.75, pt: 1.5, pb: 1 }}
    >
      {pinned.length > 0 && (
        <Box sx={{ pb: 0.5 }}>
          <ConversationGroup
            idBase="pinned-group"
            label={t("pinned")}
            conversations={pinned}
            selectedId={selectedId}
            baseDelay={0}
            collapsedIcon={<PushPinRoundedIcon sx={{ fontSize: 16 }} />}
            expandedIcon={<PushPinOutlinedIcon sx={{ fontSize: 16 }} />}
            onSelect={onSelect}
            onMove={moveConversation}
            registerRowRef={registerRowRef}
            actions={actions}
          />
        </Box>
      )}
      {visibleProjects.map((project, index) => (
        <Box key={project.id} sx={{ pb: 0.5 }}>
          <ConversationGroup
            idBase={`project-group-${project.id}`}
            label={project.name}
            conversations={project.conversations}
            selectedId={selectedId}
            baseDelay={(index + 1) * 120}
            collapsedIcon={<FolderRoundedIcon sx={{ fontSize: 17 }} />}
            expandedIcon={<FolderOpenRoundedIcon sx={{ fontSize: 17 }} />}
            onSelect={onSelect}
            onMove={moveConversation}
            registerRowRef={registerRowRef}
            actions={actions}
          />
        </Box>
      ))}
      {visibleChats.length > 0 && (
        <Box sx={{ pb: 0.5 }}>
          <ConversationGroup
            idBase="chats-group"
            label={t("chats")}
            conversations={visibleChats}
            selectedId={selectedId}
            baseDelay={(visibleProjects.length + 1) * 120}
            collapsedIcon={<ForumRoundedIcon sx={{ fontSize: 16 }} />}
            expandedIcon={<ForumOutlinedIcon sx={{ fontSize: 16 }} />}
            onSelect={onSelect}
            onMove={moveConversation}
            registerRowRef={registerRowRef}
            actions={actions}
          />
        </Box>
      )}
      {empty && <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", textAlign: "center", py: 3 }}>{t("noConversationsYet")}</Typography>}
    </Box>
  );
}
