import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import { Box, InputBase, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useI18n } from "../../i18n/I18nProvider";
import { IconButton, StatusDot } from "../ui";
import { type AgentId, getAgent, withAlpha } from "./agents";
import { rise } from "./anim";
import { messageToPlainText } from "./message-actions";
import { type ChatMessage, conversationStatusKey as statusToKey, type ConversationStatus, type ConversationSummary, type Project } from "./types";

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
// (green) render the bare avatar.
const STATUSES_WITH_DOT: ReadonlySet<ConversationStatus> = new Set<ConversationStatus>(["running", "waiting", "error"]);

type ConversationListItem =
  | {
      readonly kind: "group";
      readonly idBase: string;
      readonly label: string;
      readonly conversations: readonly ConversationSummary[];
      readonly delay: number;
      readonly collapsedIcon: ReactNode;
      readonly expandedIcon: ReactNode;
    }
  | {
      readonly kind: "conversation";
      readonly conversation: ConversationSummary;
      readonly delay: number;
    }
  | {
      readonly kind: "empty";
    };

function conversationListItemKey(index: number, item: ConversationListItem | undefined): string {
  if (item?.kind === "group") {
    return `group:${item.idBase}`;
  }
  if (item?.kind === "conversation") {
    return `conversation:${item.conversation.id}`;
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

function ConversationAvatar({ conversation }: { readonly conversation: ConversationSummary }) {
  const { conversationStatus } = useI18n();
  if (!STATUSES_WITH_DOT.has(conversation.status)) {
    return <InitialsAvatar title={conversation.title} agent={conversation.agent} />;
  }
  return (
    <Box sx={{ position: "relative", flex: "0 0 auto" }}>
      <InitialsAvatar title={conversation.title} agent={conversation.agent} />
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
}: {
  readonly idBase: string;
  readonly label: string;
  readonly conversations: readonly ConversationSummary[];
  readonly open: boolean;
  readonly delay: number;
  readonly collapsedIcon: ReactNode;
  readonly expandedIcon: ReactNode;
  readonly onToggle: (idBase: string) => void;
}) {
  const { t } = useI18n();
  const runningCount = conversations.filter((c) => c.status === "running").length;
  const hasUnread = conversations.some((c) => c.unread);
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
        {/* Collapsed only: a single indicator — running status takes priority,
            otherwise the unread marker. Never both, and no count badge. */}
        {!open &&
          (runningCount > 0 ? (
            <StatusDot status="running" label={t("runningCount", { count: runningCount })} />
          ) : hasUnread ? (
            <Box role="img" aria-label={t("unread")} sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: (t) => t.palette.status.running.main }} />
          ) : null)}
      </Stack>
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
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
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
  const listItems = useMemo<readonly ConversationListItem[]>(() => {
    if (empty) {
      return [{ kind: "empty" }];
    }

    const items: ConversationListItem[] = [];
    const addGroup = ({
      idBase,
      label,
      conversations,
      baseDelay,
      collapsedIcon,
      expandedIcon,
    }: {
      readonly idBase: string;
      readonly label: string;
      readonly conversations: readonly ConversationSummary[];
      readonly baseDelay: number;
      readonly collapsedIcon: ReactNode;
      readonly expandedIcon: ReactNode;
    }) => {
      items.push({ kind: "group", idBase, label, conversations, delay: baseDelay, collapsedIcon, expandedIcon });
      if (!collapsedGroups.has(idBase)) {
        conversations.forEach((conversation, index) => {
          items.push({ kind: "conversation", conversation, delay: baseDelay + index * 50 });
        });
      }
    };

    if (pinned.length > 0) {
      addGroup({
        idBase: "pinned-group",
        label: t("pinned"),
        conversations: pinned,
        baseDelay: 0,
        collapsedIcon: <PushPinRoundedIcon sx={{ fontSize: 16 }} />,
        expandedIcon: <PushPinOutlinedIcon sx={{ fontSize: 16 }} />,
      });
    }

    visibleProjects.forEach((project, index) => {
      addGroup({
        idBase: `project-group-${project.id}`,
        label: project.name,
        conversations: project.conversations,
        baseDelay: (index + 1) * 120,
        collapsedIcon: <FolderRoundedIcon sx={{ fontSize: 17 }} />,
        expandedIcon: <FolderOpenRoundedIcon sx={{ fontSize: 17 }} />,
      });
    });

    if (visibleChats.length > 0) {
      addGroup({
        idBase: "chats-group",
        label: t("chats"),
        conversations: visibleChats,
        baseDelay: (visibleProjects.length + 1) * 120,
        collapsedIcon: <ForumRoundedIcon sx={{ fontSize: 16 }} />,
        expandedIcon: <ForumOutlinedIcon sx={{ fontSize: 16 }} />,
      });
    }

    return items;
  }, [collapsedGroups, empty, pinned, t, visibleChats, visibleProjects]);
  // Pinned first, then projects, then chats — flattened for arrow-key navigation.
  const visibleConversationIds = useMemo(
    () => listItems.flatMap((item) => (item.kind === "conversation" ? [item.conversation.id] : [])),
    [listItems],
  );
  const conversationItemIndexes = useMemo(() => {
    const indexes = new Map<string, number>();
    listItems.forEach((item, index) => {
      if (item.kind === "conversation") {
        indexes.set(item.conversation.id, index);
      }
    });
    return indexes;
  }, [listItems]);
  const registerRowRef = (id: string, element: HTMLDivElement | null) => {
    if (element) {
      rowRefs.current.set(id, element);
    } else {
      rowRefs.current.delete(id);
    }
  };
  const focusConversation = (id: string) => {
    const index = conversationItemIndexes.get(id);
    if (index !== undefined) {
      virtuosoRef.current?.scrollToIndex({ align: "center", behavior: "auto", index });
    }
    const focus = () => rowRefs.current.get(id)?.focus();
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focus);
      window.requestAnimationFrame(() => window.requestAnimationFrame(focus));
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
          const isFirst = index === 0;
          if (item.kind === "empty") {
            return (
              <Box sx={{ px: 0.75, pt: 1.5, pb: 1 }}>
                <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", textAlign: "center", py: 3 }}>{t("noConversationsYet")}</Typography>
              </Box>
            );
          }
          if (item.kind === "group") {
            return (
              <Box sx={{ px: 0.75, pt: isFirst ? 1.5 : 0.5, pb: 0.25 }}>
                <ConversationGroupHeader
                  idBase={item.idBase}
                  label={item.label}
                  conversations={item.conversations}
                  open={!collapsedGroups.has(item.idBase)}
                  delay={item.delay}
                  collapsedIcon={item.collapsedIcon}
                  expandedIcon={item.expandedIcon}
                  onToggle={toggleGroup}
                />
              </Box>
            );
          }
          return (
            <Box sx={{ px: 0.75, pb: 0.25 }}>
              <ConversationRow
                conversation={item.conversation}
                active={item.conversation.id === selectedId}
                delay={item.delay}
                onSelect={onSelect}
                onMove={moveConversation}
                registerRowRef={registerRowRef}
                actions={actions}
              />
            </Box>
          );
        }}
      />
    </Box>
  );
}
