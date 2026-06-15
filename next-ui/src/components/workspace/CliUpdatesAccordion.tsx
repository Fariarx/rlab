import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import { Box, ButtonBase, Collapse, Stack, Typography } from "@mui/material";
import { useState } from "react";
import type { CliUpdateInfo } from "../../client/api/workspace-page-api";
import type { I18nApi } from "../../i18n/I18nProvider";
import { Button } from "../ui";

/**
 * Agent CLI update notices, collapsed into an accordion. Collapsed (the default)
 * it shows just a count badge; expanded it lists one container per agent with its
 * version bump and an update button.
 */
export function CliUpdatesAccordion({
  updates,
  busyAgent,
  onUpdate,
  t,
}: {
  readonly updates: readonly CliUpdateInfo[];
  readonly busyAgent: string | null;
  readonly onUpdate: (update: CliUpdateInfo) => void;
  readonly t: I18nApi["t"];
}) {
  const [open, setOpen] = useState(false);
  if (updates.length === 0) {
    return null;
  }
  return (
    <Box sx={{ px: 0.75, pb: 1, flex: "0 0 auto" }}>
      <Box
        sx={{
          borderRadius: (theme) => `${theme.custom.radii.md}px`,
          backgroundColor: (theme) => theme.custom.surfaces.s2,
          border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          overflow: "hidden",
        }}
      >
        <ButtonBase
          data-testid="cli-updates-accordion-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          sx={{ width: "100%", display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 0.75, textAlign: "left" }}
        >
          <Box sx={{ display: "flex", color: "text.secondary", flex: "0 0 auto" }}>
            <SystemUpdateAltIcon sx={{ fontSize: 18 }} />
          </Box>
          <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: "0.78rem", fontWeight: 600, color: "text.secondary" }}>
            {t("cliUpdateRequired")}
          </Typography>
          <Box
            component="span"
            sx={{
              flex: "0 0 auto",
              minWidth: 20,
              height: 20,
              px: 0.5,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "999px",
              backgroundColor: (theme) => theme.palette.status.warn.main,
              color: "#16110a",
              fontFamily: (theme) => theme.custom.fonts.mono,
              fontSize: "0.7rem",
              fontWeight: 800,
            }}
          >
            {updates.length}
          </Box>
          <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", flex: "0 0 auto", transition: "transform 180ms ease", transform: open ? "rotate(180deg)" : "none" }} />
        </ButtonBase>
        <Collapse in={open} unmountOnExit>
          <Stack spacing={0.75} sx={{ px: 1, pb: 1, pt: 0.25 }}>
            {updates.map((update) => (
              <Stack
                key={update.agent}
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  px: 1,
                  py: 0.75,
                  borderRadius: (theme) => `${theme.custom.radii.sm}px`,
                  backgroundColor: (theme) => theme.custom.surfaces.s1,
                  border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: "0.78rem", fontWeight: 700, color: "text.primary" }}>
                    {update.agentName}
                  </Typography>
                  <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary", mt: 0.25 }}>
                    {update.currentVersion} → {update.latestVersion}
                  </Typography>
                </Box>
                <Button variant="subtle" size="small" disabled={busyAgent !== null} onClick={() => onUpdate(update)} sx={{ flex: "0 0 auto", minWidth: 78 }}>
                  {t("updateCli")}
                </Button>
              </Stack>
            ))}
          </Stack>
        </Collapse>
      </Box>
    </Box>
  );
}
