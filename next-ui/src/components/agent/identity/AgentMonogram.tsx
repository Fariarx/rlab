import { Box } from "@mui/material";
import { type AgentId, getAgent, withAlpha } from "../core/agents";
import { AgentBrandIcon, hasAgentBrandIcon } from "./AgentBrandIcon";

/**
 * AgentMonogram — a per-agent identity tile tinted with the agent's brand
 * accent. Known brands render their SVG mark; the rest use a short monogram.
 */
export function AgentMonogram({ agent, size = 28 }: { readonly agent: AgentId; readonly size?: number }) {
  const def = getAgent(agent);
  const hasBrandIcon = hasAgentBrandIcon(agent);
  return (
    <Box
      aria-hidden="true"
      sx={{
        flex: "0 0 auto",
        width: size,
        height: size,
        borderRadius: (t) => `${t.custom.radii.sm}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: (t) => t.custom.fonts.mono,
        fontSize: size * 0.36,
        fontWeight: 700,
        letterSpacing: "0.02em",
        color: def.accent,
        backgroundColor: withAlpha(def.accent, 0.16),
        border: `1px solid ${withAlpha(def.accent, 0.32)}`,
      }}
    >
      {hasBrandIcon ? <AgentBrandIcon agent={agent} size={size * 0.62} color={def.accent} /> : def.short}
    </Box>
  );
}
