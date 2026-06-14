import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import MemoryIcon from "@mui/icons-material/Memory";
import TerminalIcon from "@mui/icons-material/Terminal";
import { Box, Stack, Typography } from "@mui/material";
import { TerminalView } from "../../workspace/terminal/TerminalView";
import { KeyHint, Metric, Panel, StatusDot, Tag } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

const sampleCwd = "/root/workspace/rlab";

export function WorkSurfacesSection() {
  return (
    <KitSectionShell
      id="work-surfaces"
      title="Рабочие поверхности"
      description="Компоненты, которые агент использует вне ленты сообщений: терминал, режим доступа к проекту и краткая runtime-сводка."
    >
      <Box
        sx={{
          display: "grid",
          gap: 2.5,
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.25fr) minmax(320px, 0.75fr)" },
        }}
      >
        <Panel title="Терминал" titleAdornment={<StatusDot status="running" label="Готов" />}>
          <Box
            sx={{
              height: 260,
              minHeight: 0,
              overflow: "hidden",
              border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              borderRadius: 2,
            }}
          >
            <TerminalView cwd={sampleCwd} />
          </Box>
        </Panel>

        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <Panel title="Доступ агента">
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <FolderOpenIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                <Typography sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.78rem", overflowWrap: "anywhere" }}>
                  {sampleCwd}
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Агент может писать в {sampleCwd}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                <Tag status="ok" label="без ограничений" />
                <Tag status="info" tone="outline" label="read-only доступен" />
              </Stack>
            </Stack>
          </Panel>

          <Panel title="Runtime">
            <Stack spacing={2}>
              <Stack direction="row" spacing={3} sx={{ flexWrap: "wrap", gap: 2 }}>
                <Metric label="Токены" value="18.4k" status="ok" />
                <Metric label="Стоимость" value="$0.42" />
              </Stack>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
                <MemoryIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2">Фоновые задачи продолжаются после закрытия вкладки.</Typography>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <TerminalIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Палитра команд
                </Typography>
                <KeyHint keys={["Ctrl", "K"]} />
              </Stack>
            </Stack>
          </Panel>
        </Stack>
      </Box>
    </KitSectionShell>
  );
}
