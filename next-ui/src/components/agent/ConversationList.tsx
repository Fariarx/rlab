import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import SearchIcon from "@mui/icons-material/Search";
import { Box, Collapse, InputAdornment, InputBase, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import { type KeyboardEvent, type MouseEvent, useMemo, useState } from "react";
import { type StatusKey } from "../../theme/tokens";
import { IconButton, StatusDot } from "../ui";
import { AgentMonogram } from "./AgentMonogram";
import { growBar, rise } from "./anim";
import { type ConversationStatus, type ConversationSummary, type Project } from "./types";

const statusToKey: Record<ConversationStatus, StatusKey> = {
  running: "running",
  waiting: "warn",
  done: "ok",
  error: "error",
  idle: "idle",
};

const statusLabel: Record<ConversationStatus, string> = {
  running: "Working",
  waiting: "Needs input",
  done: "Done",
  error: "Failed",
  idle: "Idle",
};

export interface ConversationActions {
  readonly onRename: (id: string, title: string) => void;
  readonly onArchive: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

function ConversationAvatar({ conversation }: { readonly conversation: ConversationSummary }) {
  return (
    <Box sx={{ position: "relative", flex: "0 0 auto" }}>
      <AgentMonogram agent={conversation.agent} size={28} />
      <Tooltip title={statusLabel[conversation.status]}>
        <Box sx={{ position: "absolute", right: -3, bottom: -3, borderRadius: "50%", display: "flex", p: "2px", backgroundColor: (t) => t.custom.surfaces.s1 }}>
          <StatusDot status={statusToKey[conversation.status]} label={statusLabel[conversation.status]} pulse={conversation.status === "running"} size="sm" />
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
  actions,
}: {
  readonly conversation: ConversationSummary;
  readonly active: boolean;
  readonly delay: number;
  readonly onSelect: (id: string) => void;
  readonly actions: ConversationActions;
}) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const menuOpen = Boolean(menuAnchor);

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

  return (
    <Stack
      direction="row"
      spacing={1.25}
      onClick={() => !editing && onSelect(conversation.id)}
      sx={{
        position: "relative",
        alignItems: "center",
        px: 1.25,
        py: 1,
        borderRadius: (t) => `${t.custom.radii.md}px`,
        cursor: editing ? "default" : "pointer",
        backgroundColor: (t) => (active ? t.custom.surfaces.s3 : "transparent"),
        transition: "background-color 140ms ease",
        "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 },
        "&:hover .row-more": { opacity: 1 },
        ...rise(delay),
      }}
    >
      {active && (
        <Box sx={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, backgroundColor: (t) => t.palette.status.running.main, transformOrigin: "center", animation: `${growBar} 240ms ease both` }} />
      )}
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
              <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>{conversation.time}</Typography>
              <Box
                className="row-more"
                component="span"
                sx={{ display: "flex", opacity: menuOpen ? 1 : 0, transition: "opacity 120ms ease" }}
              >
                <IconButton aria-label="Conversation actions" onClick={openMenu} sx={{ p: 0.25 }}>
                  <MoreHorizIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            </Stack>
          </Stack>
        )}
        {!editing && (
          <Typography noWrap sx={{ fontSize: "0.74rem", color: "text.secondary", mt: 0.25 }}>
            {conversation.snippet}
          </Typography>
        )}
      </Box>

      <Menu anchorEl={menuAnchor} open={menuOpen} onClose={closeMenu} onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={startRename}>Rename</MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            actions.onArchive(conversation.id);
          }}
        >
          Archive
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            actions.onDelete(conversation.id);
          }}
          sx={{ color: (t) => t.palette.status.error.main }}
        >
          Delete
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
  actions,
}: {
  readonly project: Project;
  readonly selectedId: string | null;
  readonly baseDelay: number;
  readonly onSelect: (id: string) => void;
  readonly actions: ConversationActions;
}) {
  const [open, setOpen] = useState(true);
  const runningCount = project.conversations.filter((c) => c.status === "running").length;

  return (
    <Box>
      <Stack
        direction="row"
        spacing={0.75}
        onClick={() => setOpen((v) => !v)}
        sx={{ alignItems: "center", px: 1, py: 0.75, cursor: "pointer", borderRadius: (t) => `${t.custom.radii.sm}px`, "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 } }}
      >
        <ChevronRightIcon sx={{ fontSize: 16, color: "text.secondary", transition: "transform 160ms ease", transform: open ? "rotate(90deg)" : "none" }} />
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }} noWrap>
          {project.name}
        </Typography>
        {runningCount > 0 && <StatusDot status="running" label={`${runningCount} working`} />}
        <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>{project.conversations.length}</Typography>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={0.25} sx={{ mt: 0.25, mb: 0.75 }}>
          {project.conversations.map((conversation, index) => (
            <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === selectedId} delay={baseDelay + index * 50} onSelect={onSelect} actions={actions} />
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
}: {
  readonly mode: "chats" | "projects";
  readonly projects: readonly Project[];
  readonly chats: readonly ConversationSummary[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly actions: ConversationActions;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filteredChats = useMemo(() => (q === "" ? chats : chats.filter((c) => c.title.toLowerCase().includes(q))), [chats, q]);
  const filteredProjects = useMemo(
    () => (q === "" ? projects : projects.map((p) => ({ ...p, conversations: p.conversations.filter((c) => c.title.toLowerCase().includes(q)) })).filter((p) => p.conversations.length > 0)),
    [projects, q],
  );

  const empty = mode === "chats" ? filteredChats.length === 0 : filteredProjects.length === 0;

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Box sx={{ p: 1, pb: 0.5 }}>
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === "chats" ? "Search chats…" : "Search conversations…"}
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            </InputAdornment>
          }
          sx={{ width: "100%", px: 1, py: 0.5, fontSize: "0.8rem", borderRadius: (t) => `${t.custom.radii.md}px`, backgroundColor: (t) => t.custom.surfaces.s3, border: (t) => `1px solid ${t.custom.borders.subtle}` }}
        />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1 }}>
        {mode === "chats" ? (
          <Stack spacing={0.25}>
            {filteredChats.map((conversation, index) => (
              <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === selectedId} delay={index * 50} onSelect={onSelect} actions={actions} />
            ))}
          </Stack>
        ) : (
          <Stack spacing={0.5}>
            {filteredProjects.map((project, index) => (
              <ProjectGroup key={project.id} project={project} selectedId={selectedId} baseDelay={index * 120} onSelect={onSelect} actions={actions} />
            ))}
          </Stack>
        )}
        {empty && <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", textAlign: "center", py: 3 }}>No matches</Typography>}
      </Box>
    </Stack>
  );
}
