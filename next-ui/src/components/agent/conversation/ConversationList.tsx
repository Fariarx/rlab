import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import { Box, InputBase, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useI18n } from "../../../i18n/I18nProvider";
import { conversationPreviewSnippet } from "../../../lib/conversation-preview";
import { formatConversationListTime } from "../../../lib/time-format";
import { IconButton, StatusDot } from "../../ui";
import { ConversationListStore, ConversationRowStore } from "../stores/agent-local-stores";
import { type AgentId, getAgent, withAlpha } from "../core/agents";
import { rise } from "../core/anim";
import type { ChatMessage, ConversationStatus, ConversationSummary, Project } from "../core/types";
import {
  buildConversationListItems,
  type ConversationListIconKind,
  type ConversationListItem,
  unreadAttentionStatus,
  visibleConversationSections,
  visualStatusKey,
} from "./conversation-list-model";
import { useConversationListNavigation } from "./use-conversation-list-navigation";

export interface ConversationActions {
  readonly onRename: (id: string, title: string) => void;
  readonly onTogglePin: (id: string) => void;
  readonly onArchive: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

export { conversationMatches } from "./conversation-list-model";

// Status dots on the avatar are noise for resting conversations, so only the
// live running state is persistent. Finished/failed/waiting states are attention
// signals and only get a dot while the conversation is unread.
const STATUSES_WITH_DOT: ReadonlySet<ConversationStatus> = new Set<ConversationStatus>(["running"]);
function conversationListItemKey(index: number, item: ConversationListItem | undefined): string {
  if (item?.kind === "group") {
    return `group:${item.idBase}`;
  }
  if (item?.kind === "conversation") {
    return `conversation:${item.conversation.id}`;
  }
  if (item?.kind === "show-more") {
    return `show-more:${item.idBase}`;
  }
  return `empty:${index}`;
}

/** 1–2 capitalised letters derived from the conversation title. */
function titleInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function InitialsAvatar({ title, agent }: { readonly title: string; readonly agent: AgentId }) {
  // Initials for the label, but the tile keeps the agent's brand accent (tint +
  // border + text) so the per-agent colour coding survives.
  const accent = getAgent(agent)?.accent ?? "#8B949E";
  return (
    <Box
      aria-hidden
      sx={{
        width: 32,
        height: 32,
        flex: "0 0 auto",
        borderRadius: (t) => `${t.custom.radii.sm}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: withAlpha(accent, 0.16),
        border: `1px solid ${withAlpha(accent, 0.32)}`,
        color: accent,
        fontFamily: (t) => t.custom.fonts.mono,
        fontSize: "0.7rem",
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {titleInitials(title)}
    </Box>
  );
}

function ConversationAvatar({ conversation, hasWakeup }: { readonly conversation: ConversationSummary; readonly hasWakeup: boolean }) {
  const { t, conversationStatus } = useI18n();
  const unreadAttention = unreadAttentionStatus(conversation);
  const showDot = STATUSES_WITH_DOT.has(conversation.status) || hasWakeup || unreadAttention != null;
  const label = hasWakeup
    ? t("wakeupScheduledStatus")
    : unreadAttention === "error"
      ? conversationStatus("error")
      : unreadAttention === "action"
        ? conversationStatus("waiting")
        : unreadAttention === "done"
          ? conversationStatus("done")
          : conversationStatus(conversation.status);
  const dotStatus =
    unreadAttention === "error"
      ? "error"
      : unreadAttention === "action"
        ? "warn"
        : unreadAttention === "done"
          ? "ok"
          : visualStatusKey(conversation, hasWakeup);
  const shouldPulse = conversation.status === "running" || unreadAttention === "error" || unreadAttention === "action";
  if (!showDot) {
    return <InitialsAvatar title={conversation.title} agent={conversation.agent} />;
  }
  return (
    <Box sx={{ position: "relative", flex: "0 0 auto" }}>
      <InitialsAvatar title={conversation.title} agent={conversation.agent} />
      <Tooltip title={label}>
        <Box sx={{ position: "absolute", right: -3, bottom: -3, borderRadius: "50%", display: "flex", p: "2px", backgroundColor: (t) => t.custom.surfaces.s1 }}>
          <StatusDot status={dotStatus} label={label} pulse={shouldPulse} size="sm" />
        </Box>
      </Tooltip>
    </Box>
  );
}

function selectedRowAccentStatus(conversation: ConversationSummary, hasWakeup: boolean): ReturnType<typeof visualStatusKey> | null {
  if (hasWakeup || conversation.status === "running" || unreadAttentionStatus(conversation) !== null) {
    return visualStatusKey(conversation, hasWakeup);
  }
  return null;
}

function groupIcons(iconKind: ConversationListIconKind): { readonly collapsedIcon: ReactNode; readonly expandedIcon: ReactNode } {
  switch (iconKind) {
    case "pin":
      return {
        collapsedIcon: <PushPinRoundedIcon sx={{ fontSize: 16 }} />,
        expandedIcon: <PushPinOutlinedIcon sx={{ fontSize: 16 }} />,
      };
    case "project":
      return {
        collapsedIcon: <FolderRoundedIcon sx={{ fontSize: 17 }} />,
        expandedIcon: <FolderOpenRoundedIcon sx={{ fontSize: 17 }} />,
      };
    case "chat":
      return {
        collapsedIcon: <ForumRoundedIcon sx={{ fontSize: 16 }} />,
        expandedIcon: <ForumOutlinedIcon sx={{ fontSize: 16 }} />,
      };
  }
}

type ConversationRowConfirmation = "pin" | "archive" | null;

const conversationRowActionIconSx = {
  flex: "0 0 auto",
  width: 22,
  height: 22,
  p: 0,
} as const;

function ConversationRowConfirmButton({
  children,
  onClick,
  tone = "default",
}: {
  readonly children: ReactNode;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
  readonly tone?: "default" | "danger";
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        px: 0.75,
        border: 0,
        borderRadius: (t) => `${t.custom.radii.sm}px`,
        color: (t) => (tone === "danger" ? t.palette.status.error.main : t.palette.text.primary),
        backgroundColor: (t) => (tone === "danger" ? t.palette.status.error.soft : t.custom.surfaces.s4),
        cursor: "pointer",
        font: "inherit",
        fontSize: "0.68rem",
        fontWeight: 650,
        lineHeight: 1,
        whiteSpace: "nowrap",
        "&:hover": {
          backgroundColor: (t) => (tone === "danger" ? t.palette.status.error.soft : t.custom.surfaces.s4),
        },
        "&:focus-visible": {
          outline: (t) => `2px solid ${t.custom.borders.focus}`,
          outlineOffset: 1,
        },
      }}
    >
      {children}
    </Box>
  );
}

const ConversationRow = observer(function ConversationRow({
  conversation,
  subtitle,
  active,
  delay,
  onSelect,
  onMove,
  registerRowRef,
  actions,
  hasWakeup,
}: {
  readonly conversation: ConversationSummary;
  readonly subtitle: string;
  readonly active: boolean;
  readonly delay: number;
  readonly onSelect: (id: string) => void;
  readonly onMove: (id: string, offset: -1 | 1) => void;
  readonly registerRowRef: (id: string, element: HTMLDivElement | null) => void;
  readonly actions: ConversationActions;
  readonly hasWakeup: boolean;
}) {
  const [store] = useState(() => new ConversationRowStore(conversation.title));
  const [confirmation, setConfirmation] = useState<ConversationRowConfirmation>(null);
  const { menuAnchor, setMenuAnchor, editing, setEditing, draft, setDraft } = store;
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const menuOpen = Boolean(menuAnchor);
  const { t } = useI18n();
  const activeAccent = selectedRowAccentStatus(conversation, hasWakeup);

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

  useEffect(() => {
    setConfirmation(null);
  }, [conversation.id, conversation.pinned, conversation.archived]);

  useEffect(() => {
    if (!confirmation) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rowRef.current?.contains(target)) {
        return;
      }
      setConfirmation(null);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [confirmation]);

  const openMenu = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setConfirmation(null);
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => setMenuAnchor(null);
  const togglePin = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (confirmation !== "pin") {
      setConfirmation("pin");
      return;
    }
    setConfirmation(null);
    actions.onTogglePin(conversation.id);
  };
  const archiveConversation = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (confirmation !== "archive") {
      setConfirmation("archive");
      return;
    }
    setConfirmation(null);
    actions.onArchive(conversation.id);
  };

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
      ref={(element: HTMLDivElement | null) => {
        rowRef.current = element;
        registerRowRef(conversation.id, element);
      }}
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
        boxShadow: (t) =>
          active && activeAccent
            ? `inset 3px 0 0 0 ${t.palette.status[activeAccent].main}`
            : "none",
        transition: "background-color 140ms ease, box-shadow 140ms ease",
        "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 },
        "&:hover .row-more": { opacity: 1 },
        // Fade the date out whenever the ⋯ overlay is showing (hover or open
        // menu) so the date never peeks out from under it. The date stays in the
        // layout, just transparent.
        "&:hover .row-date": { opacity: 0 },
        ...((menuOpen || confirmation) && { "& .row-date": { opacity: 0 } }),
        "&:focus-visible": {
          outline: (t) => `2px solid ${t.custom.borders.focus}`,
          outlineOffset: "-2px",
        },
        ...rise(delay),
      }}
    >
      <ConversationAvatar conversation={conversation} hasWakeup={hasWakeup} />
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
              <Typography className="row-date" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary", transition: "opacity 120ms ease" }}>
                {formatConversationListTime(conversation.time, conversation.updatedAtMs)}
              </Typography>
            </Stack>
          </Stack>
        )}
        {!editing && (
          <Typography noWrap sx={{ fontSize: "0.74rem", color: "text.secondary", mt: 0.25 }}>
            {subtitle}
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
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 0.25,
            p: 0,
            width: "fit-content",
            height: "fit-content",
            borderRadius: (t) => `${t.custom.radii.sm}px`,
            backgroundColor: (t) => t.custom.surfaces.s3,
            opacity: menuOpen || confirmation ? 1 : 0,
            transition: "opacity 120ms ease",
            "&:hover": { backgroundColor: (t) => t.custom.surfaces.s4 },
          }}
        >
          {confirmation === "pin" ? (
            <ConversationRowConfirmButton onClick={togglePin}>
              {conversation.pinned ? t("confirmUnpin") : t("confirmPin")}
            </ConversationRowConfirmButton>
          ) : (
            <Tooltip title={conversation.pinned ? t("unpin") : t("pin")}>
              <IconButton aria-label={conversation.pinned ? t("unpin") : t("pin")} onClick={togglePin} sx={conversationRowActionIconSx}>
                {conversation.pinned ? <PushPinRoundedIcon sx={{ fontSize: 16 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
          )}
          {confirmation === "archive" ? (
            <ConversationRowConfirmButton tone="danger" onClick={archiveConversation}>
              {t("confirmArchive")}
            </ConversationRowConfirmButton>
          ) : (
            <Tooltip title={t("archive")}>
              <IconButton aria-label={t("archive")} onClick={archiveConversation} sx={conversationRowActionIconSx}>
                <ArchiveOutlinedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
          <IconButton aria-label={t("conversationActions")} onClick={openMenu} sx={conversationRowActionIconSx}>
            <MoreHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      )}

      <Menu anchorEl={menuAnchor} open={menuOpen} onClose={closeMenu} onClick={(e) => e.stopPropagation()} disableRestoreFocus>
        <MenuItem onClick={startRename}>{t("rename")}</MenuItem>
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
});

/** A collapsible sidebar group header. Rows are rendered by the virtual list,
 *  so the header owns only collapse state and collapsed summary indicators. */
function ConversationGroupHeader({
  idBase,
  label,
  conversations,
  open,
  delay,
  collapsedIcon,
  expandedIcon,
  onToggle,
  wakeupConversationIds,
}: {
  readonly idBase: string;
  readonly label: string;
  readonly conversations: readonly ConversationSummary[];
  readonly open: boolean;
  readonly delay: number;
  readonly collapsedIcon: ReactNode;
  readonly expandedIcon: ReactNode;
  readonly onToggle: (idBase: string) => void;
  readonly wakeupConversationIds: ReadonlySet<string>;
}) {
  const { t, conversationStatus } = useI18n();
  const runningCount = conversations.filter((c) => c.status === "running").length;
  const actionCount = conversations.filter((c) => unreadAttentionStatus(c) === "action").length;
  const hasWakeup = conversations.some((c) => wakeupConversationIds.has(c.id));
  const hasUnread = conversations.some((c) => c.unread);
  const hasUnreadError = conversations.some((c) => unreadAttentionStatus(c) === "error");
  const hasFinishedUnread = conversations.some((c) => unreadAttentionStatus(c) === "done");
  const panelId = `${idBase}-conversations`;

  const toggleOpen = () => onToggle(idBase);
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
          ...rise(delay),
        }}
      >
        <Box sx={{ display: "flex", color: "text.secondary" }}>{open ? expandedIcon : collapsedIcon}</Box>
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }} noWrap>
          {label}
        </Typography>
        {/* Collapsed only: one priority indicator. Error attention wins, then
            user action, active work, wakeups, and finally unread completion. */}
        {!open &&
          (hasUnreadError ? (
            <StatusDot status="error" label={conversationStatus("error")} pulse />
          ) : actionCount > 0 ? (
            <StatusDot status="warn" label={t("actionRequiredCount", { count: actionCount })} pulse />
          ) : runningCount > 0 ? (
            <StatusDot status="running" label={t("runningCount", { count: runningCount })} />
          ) : hasWakeup ? (
            <StatusDot status="warn" label={t("wakeupScheduledStatus")} pulse={false} />
          ) : hasFinishedUnread ? (
            <StatusDot status="ok" label={conversationStatus("done")} pulse={false} />
          ) : hasUnread ? (
            <Box role="img" aria-label={t("unread")} sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: (t) => t.palette.status.running.main }} />
          ) : null)}
      </Stack>
    </Box>
  );
}

function ShowMoreConversationsRow({
  count,
  delay,
  onClick,
}: {
  readonly count: number;
  readonly delay: number;
  readonly onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        px: 1,
        py: 0.75,
        border: 0,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        backgroundColor: "transparent",
        color: "text.secondary",
        opacity: 0.62,
        cursor: "pointer",
        font: "inherit",
        "&:hover": {
          backgroundColor: (theme) => `${theme.custom.surfaces.s2}33`,
          color: "text.secondary",
          opacity: 0.86,
        },
        "&:focus-visible": {
          outline: (theme) => `2px solid ${theme.custom.borders.focus}`,
          outlineOffset: "-2px",
        },
        ...rise(delay),
      }}
    >
      <Typography sx={{ fontSize: "0.72rem", fontWeight: 500 }}>{t("showMoreConversations", { count })}</Typography>
    </Box>
  );
}

export const ConversationList = observer(function ConversationList({
  projects,
  chats,
  threads = {},
  selectedId,
  onSelect,
  actions,
  wakeupConversationIds = new Set<string>(),
}: {
  readonly projects: readonly Project[];
  readonly chats: readonly ConversationSummary[];
  readonly threads?: Readonly<Record<string, readonly ChatMessage[]>>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly actions: ConversationActions;
  readonly wakeupConversationIds?: ReadonlySet<string>;
}) {
  const [store] = useState(() => new ConversationListStore());
  const { collapsedGroups, setCollapsedGroups } = store;
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set<string>());
  const { t } = useI18n();

  const wakeupConversationKey = [...wakeupConversationIds].sort().join("\0");
  const modelWakeupConversationIds = useMemo(
    () => new Set(wakeupConversationKey.length > 0 ? wakeupConversationKey.split("\0") : []),
    [wakeupConversationKey],
  );
  const toggleGroup = (idBase: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(idBase)) {
        next.delete(idBase);
      } else {
        next.add(idBase);
      }
      return next;
    });
  };
  const expandGroup = (idBase: string) => {
    setExpandedGroups((current) => {
      if (current.has(idBase)) {
        return current;
      }
      const next = new Set(current);
      next.add(idBase);
      return next;
    });
  };
  const listItems = useMemo<readonly ConversationListItem[]>(() => {
    const sections = visibleConversationSections({
      projects,
      chats,
      wakeupConversationIds: modelWakeupConversationIds,
      pinnedLabel: t("pinned"),
      chatsLabel: t("chats"),
    });
    return buildConversationListItems(sections, collapsedGroups, expandedGroups);
  }, [chats, collapsedGroups, expandedGroups, modelWakeupConversationIds, projects, t]);
  const { moveConversation, registerRowRef, virtuosoRef } = useConversationListNavigation({ listItems, onSelect });

  // One unified, full-width scroll list (scrollbar flush at the right edge):
  // pinned group, then project folder-accordions, then a chats group. No mode
  // toggle, no inline search (search is a popup from the sidebar header).
  return (
    <Box
      role="listbox"
      aria-label={t("conversationList")}
      data-testid="conversation-list-virtual-list"
      data-virtualized="true"
      sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}
    >
      <Virtuoso
        ref={virtuosoRef}
        data={listItems}
        computeItemKey={conversationListItemKey}
        defaultItemHeight={72}
        increaseViewportBy={{ bottom: 480, top: 240 }}
        initialItemCount={Math.min(listItems.length, 40)}
        minOverscanItemCount={{ bottom: 8, top: 4 }}
        style={{ height: "100%", scrollbarGutter: "stable both-edges" }}
        itemContent={(index, item) => {
          if (!item) {
            return null;
          }
          const isFirst = index === 0;
          if (item.kind === "empty") {
            return (
              <Box sx={{ px: 0.75, pt: 1.5, pb: 1 }}>
                <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", textAlign: "center", py: 3 }}>{t("noConversationsYet")}</Typography>
              </Box>
            );
          }
          if (item.kind === "group") {
            const icons = groupIcons(item.iconKind);
            return (
              <Box sx={{ px: 0.75, pt: isFirst ? 1.5 : 0.5, pb: 0.25 }}>
                <ConversationGroupHeader
                  idBase={item.idBase}
                  label={item.label}
                  conversations={item.conversations}
                  open={!collapsedGroups.has(item.idBase)}
                  delay={item.delay}
                  collapsedIcon={icons.collapsedIcon}
                  expandedIcon={icons.expandedIcon}
                  onToggle={toggleGroup}
                  wakeupConversationIds={modelWakeupConversationIds}
                />
              </Box>
            );
          }
          if (item.kind === "show-more") {
            return (
              <Box sx={{ px: 0.75, pb: 0.5 }}>
                <ShowMoreConversationsRow count={item.hiddenCount} delay={item.delay} onClick={() => expandGroup(item.idBase)} />
              </Box>
            );
          }
          return (
            <Box sx={{ px: 0.75, pb: 0.25 }}>
              <ConversationRow
                conversation={item.conversation}
                subtitle={conversationPreviewSnippet(threads[item.conversation.id] ?? [], 60) || item.conversation.snippet}
                active={item.conversation.id === selectedId}
                delay={item.delay}
                onSelect={onSelect}
                onMove={moveConversation}
                registerRowRef={registerRowRef}
                actions={actions}
                hasWakeup={modelWakeupConversationIds.has(item.conversation.id)}
              />
            </Box>
          );
        }}
      />
    </Box>
  );
});
