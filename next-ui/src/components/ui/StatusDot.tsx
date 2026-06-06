import { keyframes, styled } from "@mui/material/styles";
import { type StatusKey } from "../../theme/tokens";

/**
 * StatusDot — a small color-coded status indicator. `running` pulses by default.
 * A `label` is required for accessibility (color alone isn't a usable signal).
 */
export interface StatusDotProps {
  readonly status: StatusKey;
  readonly size?: "sm" | "md";
  /** Defaults to true for `running`, false otherwise. */
  readonly pulse?: boolean;
  /** Accessible status text (e.g. "Running"). Rendered as aria-label. */
  readonly label: string;
  readonly className?: string;
}

const pulseRing = keyframes`
  0% { box-shadow: 0 0 0 0 var(--dot-glow); }
  70% { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
`;

const Dot = styled("span", {
  shouldForwardProp: (prop) => prop !== "status" && prop !== "dotSize" && prop !== "pulse",
})<{ status: StatusKey; dotSize: "sm" | "md"; pulse: boolean }>(({ theme, status, dotSize, pulse }) => {
  const accent = theme.palette.status[status];
  const diameter = dotSize === "sm" ? 7 : 9;
  return {
    display: "inline-block",
    flex: "0 0 auto",
    width: diameter,
    height: diameter,
    borderRadius: "50%",
    backgroundColor: accent.main,
    "--dot-glow": accent.border,
    animation: pulse ? `${pulseRing} 1.6s ease-out infinite` : "none",
  };
});

export function StatusDot({ status, size = "md", pulse, label, className }: StatusDotProps) {
  const shouldPulse = pulse ?? status === "running";
  return (
    <Dot
      className={className}
      status={status}
      dotSize={size}
      pulse={shouldPulse}
      role="img"
      aria-label={label}
    />
  );
}
