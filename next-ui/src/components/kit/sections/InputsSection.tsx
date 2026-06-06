import SearchIcon from "@mui/icons-material/Search";
import { InputAdornment, MenuItem, Stack, TextField } from "@mui/material";
import { Panel } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function InputsSection() {
  return (
    <KitSectionShell id="inputs" title="Поля и формы" description="TextField, поиск и select — спокойные по умолчанию.">
      <Stack spacing={2.5}>
        <Panel title="Поиск">
          <TextField
            placeholder="Фильтр агентов, запусков, логов…"
            size="small"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Panel>

        <Panel title="Поля">
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2 }}>
            <TextField label="Агент" defaultValue="delta" size="small" />
            <TextField label="Окружение" defaultValue="staging" size="small" select sx={{ minWidth: 160 }}>
              <MenuItem value="staging">стенд</MenuItem>
              <MenuItem value="production">прод</MenuItem>
            </TextField>
            <TextField label="Недоступно" defaultValue="заблокировано" size="small" disabled />
            <TextField label="Ошибка" defaultValue="плохое-значение" size="small" error helperText="невалидно" />
          </Stack>
        </Panel>
      </Stack>
    </KitSectionShell>
  );
}
