import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
import { Box, Stack, Typography } from "@mui/material";
import { RunIndicator } from "./actions";
import type { PlanBlock } from "../core/types";

/** PlanSteps — a checklist of the agent's plan with per-step run state, rendered
 *  as a self-contained card with a header + progress so it reads as a distinct
 *  section rather than blending into the surrounding blocks. */
export function PlanSteps({ block }: { readonly block: PlanBlock }) {
  const total = block.steps.length;
  const done = block.steps.filter((step) => step.state === "ok").length;
  return (
    <Box
      sx={{
        borderRadius: (t) => `${t.custom.radii.lg}px`,
        border: (t) => `1px solid ${t.custom.borders.strong}`,
        backgroundColor: (t) => t.custom.surfaces.s2,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 1.5, py: 1, borderBottom: (t) => `1px solid ${t.custom.borders.subtle}` }}
      >
        <ChecklistRoundedIcon sx={{ fontSize: 16, color: (t) => t.palette.status.running.main, flex: "0 0 auto" }} />
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
          Plan
        </Typography>
        {total > 0 && (
          <Box
            component="span"
            sx={{
              flex: "0 0 auto",
              px: 0.75,
              py: 0.125,
              borderRadius: "999px",
              fontFamily: (t) => t.custom.fonts.mono,
              fontSize: "0.66rem",
              fontWeight: 700,
              color: done === total ? (t) => t.palette.status.ok.main : "text.secondary",
              backgroundColor: (t) => t.custom.surfaces.s3,
            }}
          >
            {done}/{total}
          </Box>
        )}
      </Stack>
      <Stack spacing={0} sx={{ px: 1.5, py: 1.25 }}>
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
