import InboxIcon from "@mui/icons-material/Inbox";
import { Box, Stack, Typography } from "@mui/material";
import { Button, EmptyState, Metric, Panel, StatusDot } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function PanelsSection() {
  return (
    <KitSectionShell
      id="panels"
      title="Панели и метрики"
      description="Стандартная surface-оболочка, ключевые метрики и пустое состояние без вывода."
    >
      <Box
        sx={{
          display: "grid",
          gap: 2.5,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        }}
      >
        <Panel
          title="Runtime"
          titleAdornment={<StatusDot status="running" label="В работе" />}
          actions={<Button variant="subtle" size="small">обновить</Button>}
        >
          <Stack direction="row" spacing={4} sx={{ flexWrap: "wrap", gap: 3 }}>
            <Metric label="Пропускная способность" value="68" unit="%" delta={{ value: "4.2", direction: "up" }} status="ok" />
            <Metric label="Задержка" value="42" unit="ms" delta={{ value: "11", direction: "down" }} />
            <Metric label="Очередь" value="7" status="warn" />
          </Stack>
        </Panel>

        <Panel title="Повышенный тон" tone="raised">
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Панель на один surface-уровень ярче — для вложенного или фокусного содержимого.
          </Typography>
        </Panel>

        <Panel title="Плотная панель" dense>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Более плотные отступы для compact-списков и боковых панелей.
          </Typography>
        </Panel>

        <Panel title="Пустое состояние">
          <EmptyState
            icon={<InboxIcon />}
            title="Запусков пока нет"
            description="Запустите выполнение, чтобы увидеть активность."
            action={<Button variant="subtle" size="small">новый запуск</Button>}
          />
        </Panel>
      </Box>
    </KitSectionShell>
  );
}
