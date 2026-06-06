import { Box, Stack, Typography } from "@mui/material";
import { AgentBlockRenderer, type AgentBlock } from "../../agent";
import { Panel } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

const blocks: readonly AgentBlock[] = [
  {
    kind: "reasoning",
    text: "Проверил падающий auth-тест и изолировал границу таймера.",
    duration: "8s",
  },
  {
    kind: "text",
    text: "Стримящийся блок ответа",
    streaming: true,
  },
  {
    kind: "tool",
    name: "Read",
    summary: "src/session.ts",
    args: { file_path: "src/session.ts" },
    state: "ok",
    output: "Загружены helpers таймаута сессии.",
  },
  {
    kind: "diff",
    file: "src/session.ts",
    additions: 2,
    deletions: 1,
    lines: [
      { type: "ctx", text: "export function expiresAt(now: number) {" },
      { type: "del", text: "  return now + 60;" },
      { type: "add", text: "  const ttlSeconds = 120;" },
      { type: "add", text: "  return now + ttlSeconds;" },
      { type: "ctx", text: "}" },
    ],
  },
  {
    kind: "approval",
    title: "Применить patch таймаута сессии?",
    detail: "Агент спрашивает перед записью в папку выбранного проекта.",
  },
  {
    kind: "status",
    level: "warn",
    text: "Агент ждёт решение по permission.",
  },
];

export function AgentBlocksSection() {
  return (
    <KitSectionShell
      id="agent-blocks"
      title="Блоки агента"
      description="Покрытие renderer для расширенного вывода ассистента: стриминг текста, tools, diffs, approvals и статусы."
    >
      <Panel title="Вывод агента">
        <Box
          sx={{
            display: "grid",
            gap: 1.25,
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
          }}
        >
          {blocks.map((block, index) => (
            <Stack key={`${block.kind}-${index}`} spacing={0.75} sx={{ minWidth: 0 }}>
              <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
                {block.kind}
              </Typography>
              <AgentBlockRenderer block={block} />
            </Stack>
          ))}
        </Box>
      </Panel>
    </KitSectionShell>
  );
}
