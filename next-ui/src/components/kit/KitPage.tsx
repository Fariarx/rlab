import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { Box, Container, Divider, Link, Stack, Tooltip, Typography } from "@mui/material";
import { type ThemeMode } from "../workspace/app-settings";
import { IconButton, StatusDot } from "../ui";
import { ButtonsSection } from "./sections/ButtonsSection";
import { AgentBlocksSection } from "./sections/AgentBlocksSection";
import { ControlsSection } from "./sections/ControlsSection";
import { DataSection } from "./sections/DataSection";
import { InputsSection } from "./sections/InputsSection";
import { OverlaysSection } from "./sections/OverlaysSection";
import { PanelsSection } from "./sections/PanelsSection";
import { StatusSection } from "./sections/StatusSection";
import { TokensSection } from "./sections/TokensSection";
import { TypographySection } from "./sections/TypographySection";

interface KitPageProps {
  readonly mode?: ThemeMode;
  readonly onToggleMode?: () => void;
}

/**
 * KitPage — living documentation for the UI kit. Reachable at `#/kit`.
 * Renders every primitive with its variants and states, in dark or light mode.
 */
export function KitPage({ mode = "dark", onToggleMode }: KitPageProps) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box
        component="header"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          backgroundColor: (t) => t.custom.surfaces.s1,
          borderBottom: (t) => `1px solid ${t.custom.borders.subtle}`,
          backdropFilter: "blur(6px)",
        }}
      >
        <Container maxWidth="lg">
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", justifyContent: "space-between", py: 1.5 }}
          >
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <StatusDot status="ok" label="Живой стенд" pulse={false} />
              <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontWeight: 700, fontSize: "0.9rem" }}>
                rlab/ui-kit
              </Typography>
              <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
                библиотека компонентов
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Tooltip title={mode === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}>
                <IconButton tone="subtle" aria-label="Переключить тему" onClick={onToggleMode}>
                  {mode === "dark" ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Link href="#/agent" underline="hover" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.78rem" }}>
                агенты →
              </Link>
              <Link href="#/" underline="hover" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.78rem" }}>
                ← рабочая область
              </Link>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 5 }}>
        <Stack spacing={5} divider={<Divider flexItem />}>
          <TokensSection />
          <TypographySection />
          <ButtonsSection />
          <InputsSection />
          <ControlsSection />
          <PanelsSection />
          <AgentBlocksSection />
          <StatusSection />
          <OverlaysSection />
          <DataSection />
        </Stack>
      </Container>
    </Box>
  );
}
