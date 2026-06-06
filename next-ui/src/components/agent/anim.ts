import { keyframes } from "@mui/material/styles";

/** Entrance: fade up. Pair with a per-index animation-delay for a cascade. */
export const riseIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

/** Streaming caret blink. */
export const blink = keyframes`
  0%, 45% { opacity: 1; }
  50%, 95% { opacity: 0; }
  100% { opacity: 1; }
`;

/** Typing / thinking dots bounce. */
export const bounce = keyframes`
  0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
  40% { transform: translateY(-4px); opacity: 1; }
`;

/** Moving sheen for the live "thinking" text. */
export const shimmer = keyframes`
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
`;

/** Selected check pop. */
export const pop = keyframes`
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

/** Active indicator bar growing in from its center. */
export const growBar = keyframes`
  from { transform: scaleY(0); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
`;

/** Helper: standard entrance with a staggered delay (ms). */
export function rise(delayMs = 0) {
  return {
    animation: `${riseIn} 360ms cubic-bezier(0.22, 1, 0.36, 1) both`,
    animationDelay: `${delayMs}ms`,
  } as const;
}
