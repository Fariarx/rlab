import CloseIcon from "@mui/icons-material/Close";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { Box, Dialog, Divider, Radio, Stack, Switch, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useState } from "react";
import { type ThemeMode } from "../../lib/use-theme-mode";
import {
  AGENTS,
  type AgentId,
  AgentMonogram,
  agentStatusKey,
  agentStatusLabel,
  useAgentStatus,
} from "../agent";
import { Button, IconButton, StatusDot } from "../ui";

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly mode: ThemeMode;
  readonly onToggleMode?: () => void;
  readonly defaultAgent: AgentId;
  readonly onDefaultAgentChange: (id: AgentId) => void;
}

function SettingRow({ title, description, control }: { readonly title: string; readonly description: string; readonly control: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between", py: 1.25 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "0.86rem", fontWeight: 600, color: "text.primary" }}>{title}</Typography>
        <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>{description}</Typography>
      </Box>
      <Box sx={{ flex: "0 0 auto" }}>{control}</Box>
    </Stack>
  );
}

function AgentsSection({ defaultAgent, onDefaultAgentChange }: Pick<SettingsDialogProps, "defaultAgent" | "onDefaultAgentChange">) {
  const statusOf = useAgentStatus();
  return (
    <Stack spacing={1}>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 0.5 }}>
        Pick a default agent and review what’s available on this machine.
      </Typography>
      {AGENTS.map((a) => {
        const sys = statusOf(a.id);
        const disabled = sys === "unavailable";
        return (
          <Stack
            key={a.id}
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: "center",
              p: 1.25,
              borderRadius: (t) => `${t.custom.radii.md}px`,
              border: (t) => `1px solid ${t.custom.borders.subtle}`,
              backgroundColor: (t) => t.custom.surfaces.s2,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <AgentMonogram agent={a.id} size={30} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: "0.85rem", fontWeight: 600, color: "text.primary" }}>
                {a.name}
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                <StatusDot status={agentStatusKey[sys]} label={agentStatusLabel[sys]} size="sm" pulse={sys === "running"} />
                <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" }}>
                  {agentStatusLabel[sys]}
                </Typography>
              </Stack>
            </Box>
            {disabled ? (
              <Button variant="subtle" size="small">
                Install
              </Button>
            ) : (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary" }}>
                  default
                </Typography>
                <Radio
                  checked={defaultAgent === a.id}
                  onChange={() => onDefaultAgentChange(a.id)}
                  size="small"
                  aria-label={`Make ${a.name} the default agent`}
                />
              </Stack>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}

function AppearanceSection({ mode, onToggleMode }: Pick<SettingsDialogProps, "mode" | "onToggleMode">) {
  const [reduceMotion, setReduceMotion] = useState(false);
  return (
    <Stack divider={<Divider flexItem />}>
      <SettingRow
        title="Theme"
        description="Dark or light surface palette."
        control={
          <ToggleButtonGroup
            exclusive
            value={mode}
            onChange={(_, next: ThemeMode | null) => {
              if (next && next !== mode) {
                onToggleMode?.();
              }
            }}
          >
            <ToggleButton value="dark">
              <DarkModeIcon sx={{ fontSize: 15, mr: 0.75 }} /> Dark
            </ToggleButton>
            <ToggleButton value="light">
              <LightModeIcon sx={{ fontSize: 15, mr: 0.75 }} /> Light
            </ToggleButton>
          </ToggleButtonGroup>
        }
      />
      <SettingRow
        title="Reduce motion"
        description="Minimize entrance and status animations."
        control={<Switch checked={reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} />}
      />
    </Stack>
  );
}

function GeneralSection() {
  const [notifications, setNotifications] = useState(true);
  const [confirmDestructive, setConfirmDestructive] = useState(true);
  const [telemetry, setTelemetry] = useState(false);
  return (
    <Stack divider={<Divider flexItem />}>
      <SettingRow title="Desktop notifications" description="Notify when an agent needs input or finishes." control={<Switch checked={notifications} onChange={(e) => setNotifications(e.target.checked)} />} />
      <SettingRow title="Confirm destructive actions" description="Require approval before deletes and force-pushes." control={<Switch checked={confirmDestructive} onChange={(e) => setConfirmDestructive(e.target.checked)} />} />
      <SettingRow title="Share anonymous telemetry" description="Help improve agent routing. No code is sent." control={<Switch checked={telemetry} onChange={(e) => setTelemetry(e.target.checked)} />} />
    </Stack>
  );
}

export function SettingsDialog({ open, onClose, mode, onToggleMode, defaultAgent, onDefaultAgentChange }: SettingsDialogProps) {
  const [tab, setTab] = useState(0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", px: 2.5, pt: 2 }}>
        <Typography sx={{ fontSize: "1rem", fontWeight: 700, color: "text.primary" }}>Settings</Typography>
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>

      <Box sx={{ px: 2.5 }}>
        <Tabs value={tab} onChange={(_, v: number) => setTab(v)}>
          <Tab label="Agents" />
          <Tab label="Appearance" />
          <Tab label="General" />
        </Tabs>
      </Box>

      <Box sx={{ px: 2.5, py: 2, minHeight: 280, maxHeight: 440, overflow: "auto" }}>
        {tab === 0 && <AgentsSection defaultAgent={defaultAgent} onDefaultAgentChange={onDefaultAgentChange} />}
        {tab === 1 && <AppearanceSection mode={mode} onToggleMode={onToggleMode} />}
        {tab === 2 && <GeneralSection />}
      </Box>
    </Dialog>
  );
}
