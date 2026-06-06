import { Box } from "@mui/material";
import { type AgentId, getAgent, withAlpha } from "./agents";

/**
 * AgentMonogram — a per-agent monogram tile tinted with the agent's brand
 * accent. No SVG assets needed; reads clean in both themes. (Distinct from the
 * generic chat `AgentAvatar` sparkle in parts.tsx.)
 */
export function AgentMonogram({ agent, size = 28 }: { readonly agent: AgentId; readonly size?: number }) {
  const def = getAgent(agent);
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
      {def.short}
    </Box>
  );
}
