import { Box, Stack, Typography } from "@mui/material";
import { RunIndicator } from "./actions";
import { type PlanBlock } from "./types";

/** PlanSteps — a checklist of the agent's plan with per-step run state. */
export function PlanSteps({ block }: { readonly block: PlanBlock }) {
  return (
    <Box
      sx={{
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
        backgroundColor: (t) => t.custom.surfaces.s2,
        px: 1.5,
        py: 1.25,
      }}
    >
      <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
        Plan
      </Typography>
      <Stack spacing={0}>
        {block.steps.map((step, index) => {
          const isLast = index === block.steps.length - 1;
          return (
            <Stack key={step.label} direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
              <Stack sx={{ alignItems: "center", flex: "0 0 auto" }}>
                <Box sx={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", mt: "1px" }}>
                  <RunIndicator state={step.state} />
                </Box>
                {/* `width: "2px"` (string), not `1` — MUI treats numeric width ≤ 1
                    as a percentage, which rendered the rail as a square block. */}
                {!isLast && <Box sx={{ width: "2px", flex: 1, minHeight: 14, my: 0.25, borderRadius: "1px", backgroundColor: (t) => t.custom.borders.strong }} />}
              </Stack>
              <Typography
                sx={{
                  pb: isLast ? 0 : 1.25,
                  fontSize: "0.84rem",
                  color: step.state === "pending" ? "text.secondary" : "text.primary",
                  fontWeight: step.state === "running" ? 600 : 400,
                  textDecoration: step.state === "ok" ? "none" : "none",
                }}
              >
                {step.label}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}
