import { Stack, Typography } from "@mui/material";
import { KeyHint, Panel, StatusDot, Tag } from "../../ui";
import type { StatusKey } from "../../../theme/tokens";
import { KitSectionShell } from "../KitSectionShell";

const statuses: ReadonlyArray<{ readonly key: StatusKey; readonly label: string }> = [
  { key: "running", label: "В работе" },
  { key: "ok", label: "Здоров" },
  { key: "warn", label: "Просел" },
  { key: "error", label: "Ошибка" },
  { key: "idle", label: "Ожидает" },
  { key: "info", label: "Инфо" },
];

export function StatusSection() {
  return (
    <KitSectionShell
      id="status"
      title="Статусы и теги"
      description="StatusDot с pulse, окрашенные теги и подсказки клавиш."
    >
      <Stack spacing={2.5}>
        <Panel title="Точки статуса">
          <Stack direction="row" spacing={3} sx={{ flexWrap: "wrap", gap: 2.5 }}>
            {statuses.map(({ key, label }) => (
              <Stack key={key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <StatusDot status={key} label={label} />
                <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.78rem" }}>{label}</Typography>
              </Stack>
            ))}
          </Stack>
        </Panel>

        <Panel title="Теги">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              {statuses.map(({ key, label }) => (
                <Tag key={key} status={key} label={label} />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              {statuses.map(({ key, label }) => (
                <Tag key={key} status={key} tone="outline" label={label} />
              ))}
              <Tag label="нейтральный" />
            </Stack>
          </Stack>
        </Panel>

        <Panel title="Подсказки клавиш">
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2, alignItems: "center" }}>
            <KeyHint keys="⌘ K" />
            <KeyHint keys={["⌘", "K"]} separator="+" />
            <KeyHint keys={["Ctrl", "C"]} separator="-" />
            <KeyHint keys="⏎" />
            <KeyHint keys="Esc" />
          </Stack>
        </Panel>
      </Stack>
    </KitSectionShell>
  );
}
