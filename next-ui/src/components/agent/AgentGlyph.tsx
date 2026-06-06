import { Box } from "@mui/material";
import { siClaude, siCursor, siGithubcopilot, siGooglegemini, siQwen, type SimpleIcon } from "simple-icons";
import { type AgentId, getAgent } from "./agents";

/**
 * AgentGlyph — the agent's real brand logo (via simple-icons) drawn in its
 * accent color. Brands that simple-icons doesn't ship (OpenAI/Codex,
 * Sourcegraph/Amp, OpenCode, Factory/Droid) fall back to a clean filled tile
 * with the agent's short code.
 */
const BRAND_ICON: Partial<Record<AgentId, SimpleIcon>> = {
  "claude-code": siClaude,
  gemini: siGooglegemini,
  cursor: siCursor,
  qwen: siQwen,
  copilot: siGithubcopilot,
};

export function AgentGlyph({ agent, size = 20 }: { readonly agent: AgentId; readonly size?: number }) {
  const def = getAgent(agent);
  const icon = BRAND_ICON[agent];

  if (icon) {
    return (
      <Box aria-hidden="true" sx={{ flex: "0 0 auto", display: "flex", width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 24 24" role="presentation">
          <path d={icon.path} fill={def.accent} />
        </svg>
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
