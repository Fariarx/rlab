import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Box, Stack, Typography } from "@mui/material";
import { StatusDot } from "../ui";
import { AgentMonogram } from "./AgentMonogram";
import { type AgentProfile, type AgentSystemStatus, agentStatusKey, agentStatusLabel, getAgent } from "./agents";
import { useAgentStatus } from "./use-agent-status";

/**
 * AgentBadge — the current agent shown as a clickable control: monogram, name
 * (+ variant), and the agent's system-status dot. Opens the agent picker.
 */
export function AgentBadge({
  profile,
  status,
  onClick,
  fill,
}: {
  readonly profile: AgentProfile;
  readonly status?: AgentSystemStatus;
  readonly onClick?: () => void;
  readonly fill?: boolean;
}) {
  const def = getAgent(profile.agent);
  const statusOf = useAgentStatus();
  const sys = status ?? statusOf(profile.agent);

  return (
    <Stack
      direction="row"
      spacing={1}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Agent: ${def.name}. Change agent` : undefined}
      sx={{
        alignItems: "center",
        width: fill ? "100%" : "auto",
        px: 1,
        py: 0.75,
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
        backgroundColor: (t) => t.custom.surfaces.s2,
        cursor: onClick ? "pointer" : "default",
        transition: "background-color 140ms ease, border-color 140ms ease",
        "&:hover": onClick ? { backgroundColor: (t) => t.custom.surfaces.s3, borderColor: (t) => t.custom.borders.strong } : undefined,
      }}
    >
      <AgentMonogram agent={profile.agent} size={24} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.8rem", fontWeight: 600, color: "text.primary", lineHeight: 1.2 }}>
          {def.name}
          {profile.variant !== "DEFAULT" && (
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
              {" · "}
              {profile.variant}
            </Box>
          )}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.1 }}>
          <StatusDot status={agentStatusKey[sys]} label={agentStatusLabel[sys]} size="sm" pulse={sys === "running"} />
          <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>
            {agentStatusLabel[sys]}
          </Typography>
        </Stack>
      </Box>
      {onClick && <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary" }} />}
    </Stack>
  );
}
