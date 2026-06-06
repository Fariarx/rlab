import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Stack } from "@mui/material";
import { Button, Panel } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function ButtonsSection() {
  return (
    <KitSectionShell id="buttons" title="Кнопки" description="Стандартные MUI-варианты плюс моноширинный вторичный вариант `subtle`.">
      <Panel title="Варианты">
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <Button variant="contained" startIcon={<PlayArrowIcon />}>
              Запустить прогон
            </Button>
            <Button variant="outlined">Контурная</Button>
            <Button variant="text">Текстовая</Button>
            <Button variant="subtle" startIcon={<RefreshIcon />}>
              Спокойная
            </Button>
            <Button variant="contained" color="error">
              Остановить
            </Button>
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <Button variant="contained" size="small">
              Маленькая
            </Button>
            <Button variant="subtle" size="small">
              Спокойная sm
            </Button>
            <Button variant="contained" disabled>
              Недоступна
            </Button>
            <Button variant="subtle" disabled>
              Спокойная off
            </Button>
          </Stack>
        </Stack>
      </Panel>
    </KitSectionShell>
  );
}
