import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Box, Stack, Typography } from "@mui/material";
import { useI18n } from "../../i18n/I18nProvider";
import { StatusDot } from "../ui";
import { AgentGlyph } from "./AgentGlyph";
import { AgentMonogram } from "./AgentMonogram";
import { type AgentProfile, type AgentSystemStatus, agentProfileLabels, agentStatusKey, getAgent } from "./agents";
import { useAgentStatus } from "./use-agent-status";

/**
 * AgentBadge — the current agent shown as a clickable control: monogram, name
 * (+ non-default profile details), and the agent's system-status dot.
 */
export function AgentBadge({
  profile,
  status,
  onClick,
  fill,
  compact,
}: {
  readonly profile: AgentProfile;
  readonly status?: AgentSystemStatus;
  readonly onClick?: () => void;
  readonly fill?: boolean;
  /** Single-line, header-sized badge (monogram + name + status dot). */
  readonly compact?: boolean;
}) {
  const def = getAgent(profile.agent);
  const statusOf = useAgentStatus();
  const { t, agentStatus } = useI18n();
  const sys = status ?? statusOf(profile.agent);
  const labels = agentProfileLabels(profile);

  if (compact) {
    return (
      <Stack
        direction="row"
        spacing={0.6}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={onClick ? t("changeAgentLabel", { agent: def.name }) : undefined}
        sx={{
          alignItems: "center",
          maxWidth: 220,
          height: 30,
          pl: 0.6,
          pr: 0.4,
          borderRadius: (t) => `${t.custom.radii.sm}px`,
          border: (t) => `1px solid ${t.custom.borders.subtle}`,
          backgroundColor: (t) => t.custom.surfaces.s2,
          cursor: onClick ? "pointer" : "default",
          transition: "background-color 140ms ease, border-color 140ms ease",
          "&:hover": onClick ? { backgroundColor: (t) => t.custom.surfaces.s3, borderColor: (t) => t.custom.borders.strong } : undefined,
        }}
      >
        <Box sx={{ position: "relative", display: "flex", flex: "0 0 auto" }}>
          <AgentGlyph agent={profile.agent} size={20} />
          <Box sx={{ position: "absolute", right: -3, bottom: -3, borderRadius: "50%", display: "flex", p: "1px", backgroundColor: (t) => t.custom.surfaces.s1 }}>
            <StatusDot status={agentStatusKey[sys]} label={agentStatus(sys)} size="sm" pulse={sys === "running"} />
          </Box>
        </Box>
        <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.76rem", fontWeight: 600, color: "text.primary", display: { xs: "none", sm: "block" } }}>
          {def.name}
          {labels.length > 0 && (
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>{` · ${labels.join(" · ")}`}</Box>
          )}
        </Typography>
        {onClick && <KeyboardArrowDownIcon sx={{ fontSize: 16, color: "text.secondary", flex: "0 0 auto" }} />}
      </Stack>
    );
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? t("changeAgentLabel", { agent: def.name }) : undefined}
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
          {labels.length > 0 && (
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
              {" · "}
              {labels.join(" · ")}
            </Box>
          )}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.1 }}>
          <StatusDot status={agentStatusKey[sys]} label={agentStatus(sys)} size="sm" pulse={sys === "running"} />
          <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>
            {agentStatus(sys)}
          </Typography>
        </Stack>
      </Box>
      {onClick && <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary" }} />}
    </Stack>
  );
}
