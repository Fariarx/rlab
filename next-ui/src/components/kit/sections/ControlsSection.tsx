import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import SettingsIcon from "@mui/icons-material/Settings";
import StarIcon from "@mui/icons-material/StarBorder";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import {
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  Panel,
  Radio,
  RadioGroup,
  Slider,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "../../ui";
import { KitSectionShell } from "../KitSectionShell";
import { ControlsSectionStore } from "./kit-section-stores";

export const ControlsSection = observer(function ControlsSection() {
  const [store] = useState(() => new ControlsSectionStore());
  const { view, env, setView, setEnv } = store;

  return (
    <KitSectionShell
      id="controls"
      title="Контролы"
      description="Чекбоксы, переключатели, радиогруппы, икон-кнопки, сегменты и слайдеры."
    >
      <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        <Panel title="Чекбоксы">
          <Stack spacing={1}>
            <FormControlLabel control={<Checkbox defaultChecked />} label="Следить за выполнением" />
            <FormControlLabel control={<Checkbox indeterminate />} label="Частичный выбор" />
            <FormControlLabel control={<Checkbox />} label="Уведомлять о падении" />
            <FormControlLabel control={<Checkbox disabled />} label="Недоступно" />
          </Stack>
        </Panel>

        <Panel title="Переключатели">
          <Stack spacing={1}>
            <FormControlLabel control={<Switch defaultChecked />} label="Авто-retry" />
            <FormControlLabel control={<Switch />} label="Подробные логи" />
            <FormControlLabel control={<Switch disabled />} label="Недоступно" />
          </Stack>
        </Panel>

        <Panel title="Радиогруппа">
          <RadioGroup value={env} onChange={(_, value) => setEnv(value)}>
            <FormControlLabel value="staging" control={<Radio />} label="Стенд" />
            <FormControlLabel value="production" control={<Radio />} label="Прод" />
            <FormControlLabel value="local" control={<Radio />} label="Локально" disabled />
          </RadioGroup>
        </Panel>

        <Panel title="Икон-кнопки">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <IconButton aria-label="Настройки">
                <SettingsIcon fontSize="small" />
              </IconButton>
              <IconButton tone="subtle" aria-label="Обновить">
                <RefreshIcon fontSize="small" />
              </IconButton>
              <IconButton tone="subtle" aria-label="Избранное">
                <StarIcon fontSize="small" />
              </IconButton>
              <IconButton tone="danger" aria-label="Удалить">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
              обычная · спокойная · опасная
            </Typography>
          </Stack>
        </Panel>

        <Panel title="Сегменты">
          <ToggleButtonGroup
            exclusive
            value={view}
            onChange={(_, value: string | null) => value != null && setView(value)}
          >
            <ToggleButton value="list">список</ToggleButton>
            <ToggleButton value="board">доска</ToggleButton>
            <ToggleButton value="graph">граф</ToggleButton>
          </ToggleButtonGroup>
        </Panel>

        <Panel title="Слайдер">
          <Box sx={{ px: 1, pt: 1 }}>
            <Slider defaultValue={64} valueLabelDisplay="auto" />
            <Slider defaultValue={[20, 70]} valueLabelDisplay="auto" />
          </Box>
        </Panel>
      </Box>
    </KitSectionShell>
  );
});
