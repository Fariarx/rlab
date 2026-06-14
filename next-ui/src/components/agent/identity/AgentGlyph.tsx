import { Box } from "@mui/material";
import { type AgentId, getAgent } from "../core/agents";
import { AgentBrandIcon, hasAgentBrandIcon } from "./AgentBrandIcon";

/**
 * AgentGlyph — the agent's real brand logo (via simple-icons) drawn in its
 * accent color. Brands that do not have a known SVG still fall back to a clean
 * filled tile with the agent's short code.
 */
export function AgentGlyph({ agent, size = 20 }: { readonly agent: AgentId; readonly size?: number }) {
  const def = getAgent(agent);

  if (hasAgentBrandIcon(agent)) {
    return (
      <Box aria-hidden="true" sx={{ flex: "0 0 auto", display: "flex", width: size, height: size }}>
        <AgentBrandIcon agent={agent} size={size} color={def.accent} />
      </Box>
    );
  }

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
        fontSize: size * 0.4,
        fontWeight: 700,
        letterSpacing: "0.01em",
        color: "#fff",
        backgroundColor: def.accent,
      }}
    >
      {def.short}
    </Box>
  );
}
