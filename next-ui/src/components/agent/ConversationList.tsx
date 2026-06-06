import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import SearchIcon from "@mui/icons-material/Search";
import { Box, Collapse, InputAdornment, InputBase, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import { type KeyboardEvent, type MouseEvent, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useI18n } from "../../i18n/I18nProvider";
import { IconButton, StatusDot } from "../ui";
import { AgentMonogram } from "./AgentMonogram";
import { rise } from "./anim";
import { messageToPlainText } from "./message-actions";
import { type ChatMessage, conversationStatusKey as statusToKey, type ConversationSummary, type Project } from "./types";
import { formatCostUsd, formatTokenUsage } from "./usage-cost";

export interface ConversationActions {
  readonly onRename: (id: string, title: string) => void;
  readonly onArchive: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

function conversationMatches(conversation: ConversationSummary, query: string, threads: Readonly<Record<string, readonly ChatMessage[]>>): boolean {
  const threadText = (threads[conversation.id] ?? []).map(messageToPlainText).join("\n");
  const searchable = `${conversation.title}\n${conversation.snippet}\n${threadText}`.toLowerCase();
  return searchable.includes(query);
}

function ConversationAvatar({ conversation }: { readonly conversation: ConversationSummary }) {
  const { conversationStatus } = useI18n();
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
  const menuOpen = Boolean(menuAnchor);
  const { t } = useI18n();

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
        "&:focus-visible": {
          outline: (t) => `2px solid ${t.custom.borders.focus}`,
          outlineOffset: 2,
        },
        ...rise(delay),
      }}
    >
      <ConversationAvatar conversation={conversation} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <InputBase
            value={draft}
            autoFocus
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
              border: (t) => `1px solid ${t.custom.borders.focus}`,
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
              <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>{conversation.time}</Typography>
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

      <Menu anchorEl={menuAnchor} open={menuOpen} onClose={closeMenu} onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={startRename}>{t("rename")}</MenuItem>
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

function ProjectGroup({
  project,
  selectedId,
  baseDelay,
  onSelect,
  onMove,
  registerRowRef,
  actions,
}: {
  readonly project: Project;
  readonly selectedId: string | null;
  readonly baseDelay: number;
  readonly onSelect: (id: string) => void;
  readonly onMove: (id: string, offset: -1 | 1) => void;
  readonly registerRowRef: (id: string, element: HTMLDivElement | null) => void;
  readonly actions: ConversationActions;
}) {
  const [open, setOpen] = useState(true);
  const { t } = useI18n();
  const runningCount = project.conversations.filter((c) => c.status === "running").length;
  const panelId = `project-group-${project.id}-conversations`;

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
          "&:focus-visible": {
            outline: (t) => `2px solid ${t.custom.borders.focus}`,
            outlineOffset: 2,
          },
        }}
      >
        <ChevronRightIcon sx={{ fontSize: 16, color: "text.secondary", transition: "transform 160ms ease", transform: open ? "rotate(90deg)" : "none" }} />
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }} noWrap>
          {project.name}
        </Typography>
        {runningCount > 0 && <StatusDot status="running" label={t("runningCount", { count: runningCount })} />}
        <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>{project.conversations.length}</Typography>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack id={panelId} spacing={0.25} sx={{ mt: 0.25, mb: 0.75 }}>
          {project.conversations.map((conversation, index) => (
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
  mode,
  projects,
  chats,
  selectedId,
  onSelect,
  actions,
  threads = {},
}: {
  readonly mode: "chats" | "projects";
  readonly projects: readonly Project[];
  readonly chats: readonly ConversationSummary[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly actions: ConversationActions;
  readonly threads?: Readonly<Record<string, readonly ChatMessage[]>>;
}) {
  const [query, setQuery] = useState("");
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const { t } = useI18n();
  const q = query.trim().toLowerCase();

  const filteredChats = useMemo(() => (q === "" ? chats : chats.filter((c) => conversationMatches(c, q, threads))), [chats, q, threads]);
  const filteredProjects = useMemo(
    () => (q === "" ? projects : projects.map((p) => ({ ...p, conversations: p.conversations.filter((c) => conversationMatches(c, q, threads)) })).filter((p) => p.conversations.length > 0)),
    [projects, q, threads],
  );

  const empty = mode === "chats" ? filteredChats.length === 0 : filteredProjects.length === 0;
  const visibleConversationIds = useMemo(
    () => (mode === "chats" ? filteredChats.map((conversation) => conversation.id) : filteredProjects.flatMap((project) => project.conversations.map((conversation) => conversation.id))),
    [filteredChats, filteredProjects, mode],
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

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Box sx={{ p: 1, pb: 0.5 }}>
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === "chats" ? t("searchChats") : t("searchConversations")}
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            </InputAdornment>
          }
          sx={{ width: "100%", px: 1, py: 0.5, fontSize: "0.8rem", borderRadius: (t) => `${t.custom.radii.md}px`, backgroundColor: (t) => t.custom.surfaces.s3, border: (t) => `1px solid ${t.custom.borders.subtle}` }}
        />
      </Box>

      {/* No horizontal padding here so the Virtuoso scroller is full-width and
          its scrollbar sits flush at the container's right edge; the per-item
          wrappers carry the horizontal inset instead. */}
      <Box sx={{ flex: 1, minHeight: 0, pt: 0.5 }}>
        {mode === "chats" ? (
          <Box data-testid="conversation-list-virtual-list" data-virtualized="true" role="listbox" aria-label={t("conversationList")} sx={{ height: "100%", minHeight: 0 }}>
            <Virtuoso<ConversationSummary>
              data={filteredChats}
              computeItemKey={(index, conversation) => conversation?.id ?? `chat-placeholder-${index}`}
              initialItemCount={Math.min(filteredChats.length, 20)}
              itemContent={(index, conversation) => (
                <Box sx={{ px: 1, pb: 0.25 }}>
                  {conversation && (
                    <ConversationRow
                      conversation={conversation}
                      active={conversation.id === selectedId}
                      delay={index * 50}
                      onSelect={onSelect}
                      onMove={moveConversation}
                      registerRowRef={registerRowRef}
                      actions={actions}
                    />
                  )}
                </Box>
              )}
              overscan={360}
              style={{ height: "100%" }}
            />
          </Box>
        ) : (
          <Box data-testid="conversation-list-virtual-list" data-virtualized="true" role="listbox" aria-label={t("conversationList")} sx={{ height: "100%", minHeight: 0 }}>
            <Virtuoso<Project>
              data={filteredProjects}
              computeItemKey={(index, project) => project?.id ?? `project-placeholder-${index}`}
              initialItemCount={Math.min(filteredProjects.length, 20)}
              itemContent={(index, project) => (
                <Box sx={{ px: 1, pb: 0.5 }}>
                  {project && (
                    <ProjectGroup
                      project={project}
                      selectedId={selectedId}
                      baseDelay={index * 120}
                      onSelect={onSelect}
                      onMove={moveConversation}
                      registerRowRef={registerRowRef}
                      actions={actions}
                    />
                  )}
                </Box>
              )}
              overscan={360}
              style={{ height: "100%" }}
            />
          </Box>
        )}
        {empty && <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", textAlign: "center", py: 3 }}>{t("noMatches")}</Typography>}
      </Box>
    </Stack>
  );
}
