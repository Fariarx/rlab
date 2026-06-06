import AddIcon from "@mui/icons-material/Add";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MenuIcon from "@mui/icons-material/Menu";
import ReplayIcon from "@mui/icons-material/Replay";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  Box,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  Link,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { type ThemeMode } from "../../lib/use-theme-mode";
import {
  type AgentProfile,
  AgentBadge,
  AgentPicker,
  Composer,
  Conversation,
  ConversationList,
  DEFAULT_PROFILE,
} from "../agent";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Button, EmptyState, IconButton, StatusDot, useToast } from "../ui";
import { useWorkspace } from "./use-workspace";

type WorkspaceMode = "chats" | "projects";
const SIDEBAR_WIDTH = 300;

interface WorkspacePageProps {
  readonly mode?: ThemeMode;
  readonly onToggleMode?: () => void;
}

export function WorkspacePage({ mode = "dark", onToggleMode }: WorkspacePageProps) {
  const ws = useWorkspace();
  const { toast } = useToast();

  const [wsMode, setWsMode] = useState<WorkspaceMode>("chats");
  const [profile, setProfile] = useState<AgentProfile>(DEFAULT_PROFILE);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIntent, setPickerIntent] = useState<"switch" | "new">("switch");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);

  const selected = ws.find(ws.selectedId);
  const messages = ws.threads[ws.selectedId] ?? [];

  const openConversation = (id: string) => {
    ws.select(id);
    const conv = ws.find(id);
    if (conv) {
      setProfile({ agent: conv.agent, variant: "DEFAULT" });
    }
    setDrawerOpen(false);
    setRunKey((k) => k + 1);
  };

  const switchMode = (next: WorkspaceMode) => {
    setWsMode(next);
    const firstId = next === "chats" ? ws.chats[0]?.id : ws.projects.find((p) => p.conversations.length > 0)?.conversations[0]?.id;
    if (firstId) {
      openConversation(firstId);
    }
  };

  const openPicker = (intent: "switch" | "new") => {
    setPickerIntent(intent);
    setPickerOpen(true);
  };

  const handlePicked = (picked: AgentProfile) => {
    setProfile(picked);
    if (pickerIntent === "new") {
      ws.newChat(picked.agent);
      setWsMode("chats");
      setRunKey((k) => k + 1);
      toast({ message: `New chat with ${picked.agent}`, severity: "info", duration: 2500 });
    }
  };

  const conversationActions = {
    onRename: ws.rename,
    onArchive: (id: string) => {
      ws.remove(id);
      toast({ message: "Conversation archived", severity: "info", duration: 2500 });
    },
    onDelete: (id: string) => setConfirmDelete(id),
  };

  const doDelete = () => {
    if (confirmDelete) {
      ws.remove(confirmDelete);
      setConfirmDelete(null);
      toast({ message: "Conversation deleted", severity: "warning", duration: 2500 });
    }
  };

  const sidebar = (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: (t) => t.custom.surfaces.s1 }}>
      <Stack spacing={1.25} sx={{ p: 1.5, borderBottom: (t) => `1px solid ${t.custom.borders.subtle}` }}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontWeight: 700, fontSize: "0.9rem" }}>rlab / agents</Typography>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Settings">
              <IconButton aria-label="Settings" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="New conversation">
              <IconButton tone="subtle" aria-label="New conversation" onClick={() => openPicker("new")}>
                <AddIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <AgentBadge profile={profile} onClick={() => openPicker("switch")} fill />

        <ToggleButtonGroup
          exclusive
          value={wsMode}
          onChange={(_, next: WorkspaceMode | null) => next && switchMode(next)}
          sx={{ display: "flex", "& .MuiToggleButton-root": { flex: 1 } }}
        >
          <ToggleButton value="chats">Chats</ToggleButton>
          <ToggleButton value="projects">Projects</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <ConversationList mode={wsMode} projects={ws.projects} chats={ws.chats} selectedId={ws.selectedId} onSelect={openConversation} actions={conversationActions} />
    </Stack>
  );

  return (
    <Box sx={{ height: "100dvh", display: "flex", overflow: "hidden", bgcolor: "background.default" }}>
      <Box sx={{ display: { xs: "none", md: "block" }, width: SIDEBAR_WIDTH, flex: "0 0 auto", borderRight: (t) => `1px solid ${t.custom.borders.subtle}` }}>{sidebar}</Box>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} sx={{ display: { md: "none" } }} slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, backgroundImage: "none" } } }}>
        {sidebar}
      </Drawer>

      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Box component="header" sx={{ flex: "0 0 auto", backgroundColor: (t) => t.custom.surfaces.s1, borderBottom: (t) => `1px solid ${t.custom.borders.subtle}` }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between", px: { xs: 1.5, sm: 3 }, py: 1.5 }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
              <IconButton aria-label="Open conversations" onClick={() => setDrawerOpen(true)} sx={{ display: { md: "none" } }}>
                <MenuIcon sx={{ fontSize: 20 }} />
              </IconButton>
              {selected && <StatusDot status="running" label="Agent online" pulse={selected.status === "running"} />}
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontWeight: 700, fontSize: "0.9rem" }}>
                  {selected?.title ?? "No conversation"}
                </Typography>
                {selected && ws.cwdOf(ws.selectedId) && (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", display: { xs: "none", sm: "flex" } }}>
                    <FolderOutlinedIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                    <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>
                      {ws.cwdOf(ws.selectedId)}
                    </Typography>
                  </Stack>
                )}
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: "0 0 auto" }}>
              <Tooltip title="Replay animations">
                <IconButton tone="subtle" aria-label="Replay" onClick={() => setRunKey((k) => k + 1)}>
                  <ReplayIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={mode === "dark" ? "Switch to light" : "Switch to dark"}>
                <IconButton tone="subtle" aria-label="Toggle theme" onClick={onToggleMode}>
                  {mode === "dark" ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Link href="#/kit" underline="hover" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.78rem", display: { xs: "none", sm: "block" } }}>
                kit →
              </Link>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, overflow: "auto" }}>
          <Container maxWidth="md" sx={{ py: { xs: 2.5, sm: 4 }, height: messages.length === 0 ? "100%" : "auto" }}>
            {!selected ? (
              <Stack sx={{ height: "100%", justifyContent: "center" }}>
                <EmptyState icon={<ChatBubbleOutlineIcon />} title="No conversation selected" description="Pick a conversation from the sidebar, or start a new one." action={<Button variant="contained" onClick={() => openPicker("new")}>New chat</Button>} />
              </Stack>
            ) : messages.length === 0 ? (
              <Stack sx={{ height: "100%", justifyContent: "center" }}>
                <EmptyState icon={<ChatBubbleOutlineIcon />} title="Start the conversation" description={`Message ${selected.title} below — the agent has full computer access.`} />
              </Stack>
            ) : (
              <Conversation
                key={`${ws.selectedId}-${runKey}`}
                messages={messages}
                typing={selected.status === "running" && messages[messages.length - 1]?.role === "user"}
              />
            )}
          </Container>
        </Box>

        <Box sx={{ flex: "0 0 auto", borderTop: (t) => `1px solid ${t.custom.borders.subtle}`, backgroundColor: (t) => t.custom.surfaces.s1 }}>
          <Container maxWidth="md" sx={{ py: 1.5 }}>
            <Composer
              placeholder={selected ? `Message ${selected.title}…` : "Start a new conversation…"}
              onSend={(text) => {
                if (selected) {
                  ws.sendMessage(ws.selectedId, text);
                }
              }}
            />
          </Container>
        </Box>
      </Box>

      <AgentPicker open={pickerOpen} value={profile} onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mode={mode}
        onToggleMode={onToggleMode}
        defaultAgent={profile.agent}
        onDefaultAgentChange={(id) => setProfile({ agent: id, variant: "DEFAULT" })}
      />

      <Dialog open={confirmDelete != null} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete conversation?</DialogTitle>
        <DialogContent>
          <DialogContentText>This permanently removes the conversation and its thread.</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button variant="text" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={doDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
