import { Stack, Typography } from "@mui/material";
import { Panel } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function TypographySection() {
  return (
    <KitSectionShell
      id="typography"
      title="Типографика"
      description="Inter для основного текста, JetBrains Mono для технических элементов: метки, код, статусы, метрики."
    >
      <Stack spacing={2.5}>
        <Panel title="Масштаб">
          <Stack spacing={1.5}>
            <Typography variant="h1">Центр управления</Typography>
            <Typography variant="h2">Release-прогоны и handoff агентов</Typography>
            <Typography variant="body1">
              Основной текст использует Inter. Интерфейс остаётся спокойным, чтобы monospace-акценты хорошо читались.
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Вторичный текст — приглушённый, для вспомогательных деталей.
            </Typography>
            <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
              Микрометка · разряженный mono
            </Typography>
          </Stack>
        </Panel>

        <Panel title="Моноширинный текст">
          <Stack spacing={1}>
            <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.9rem" }}>
              const run = await rlab.runs.create(&#123; agent: "delta" &#125;)
            </Typography>
            <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.9rem", color: "text.secondary" }}>
              0O 1lI |&gt; =&gt; != &amp;&amp; ?? ::: AGENT · RUNNING · 42ms
            </Typography>
          </Stack>
        </Panel>
      </Stack>
    </KitSectionShell>
  );
}
