import type { ChatMessage, ConversationSummary, Project } from "../domain/agent-types";
import { formatClock24 } from "./time-format";

/** The detailed sample thread (flaky-test investigation). */
const flakyThread: readonly ChatMessage[] = [
  { id: "u1", role: "user", time: "14:02", text: "Разбери flaky-тест `auth.login` и предложи исправление." },
  {
    id: "a1",
    role: "agent",
    time: "14:02",
    blocks: [
      {
        kind: "reasoning",
        duration: "6s",
        text: "Сьют проходит при повторе, значит проблема похожа на зависимость от времени. Скорее всего, проверка срока действия токена читает реальные часы. Сначала воспроизведу, затем прочитаю тест, подтвержу работу с часами и переведу проверку на fake timers.",
      },
      { kind: "text", text: "Сначала воспроизведу падение, затем посмотрю тест и то, как он измеряет срок действия токена." },
      {
        kind: "plan",
        steps: [
          { label: "Воспроизвести flaky-падение", state: "ok" },
          { label: "Прочитать падающий тест", state: "ok" },
          { label: "Исправить работу с часами", state: "running" },
          { label: "Проверить на повторных запусках", state: "pending" },
        ],
      },
      { kind: "command", command: "npm test -- auth.login", state: "ok", exitCode: 0, output: "✓ auth.login (1 retry)\n1 flaky · passed on attempt 2/2" },
      {
        kind: "tool",
        name: "read_file",
        summary: "test/auth/login.test.ts",
        state: "ok",
        duration: "120ms",
        args: { path: "test/auth/login.test.ts", range: "40-72" },
        output: "expect(token.expiresAt).toBeGreaterThan(Date.now() + 3600_000);",
      },
      {
        kind: "search",
        query: "vitest fake timers token expiry flaky",
        state: "ok",
        results: [
          { title: "Vitest — Fake Timers (vi.useFakeTimers)", url: "vitest.dev/api/vi#vi-usefaketimers" },
          { title: "RFC 0042 — deterministic clocks in tests", url: "rlab/rfcs/0042-clocks" },
        ],
      },
      { kind: "text", text: "Причина подтверждена: тест сравнивает `expiresAt` с реальным `Date.now()`, поэтому flaky под нагрузкой. Переход на fake timers делает проверку детерминированной." },
      {
        kind: "diff",
        file: "test/auth/login.test.ts",
        additions: 4,
        deletions: 2,
        lines: [
          { type: "ctx", text: "describe('auth.login', () => {" },
          { type: "add", text: "  beforeEach(() => vi.useFakeTimers());" },
          { type: "add", text: "  afterEach(() => vi.useRealTimers());" },
          { type: "del", text: "  it('issues a token', async () => {" },
          { type: "add", text: "  it('issues a token', async () => {" },
          { type: "del", text: "    expect(token.expiresAt).toBeGreaterThan(Date.now() + 3600_000);" },
          { type: "add", text: "    expect(token.expiresAt).toBe(NOW + 3600_000);" },
          { type: "ctx", text: "  });" },
        ],
      },
      { kind: "approval", title: "Применить patch к test/auth/login.test.ts?", detail: "Переводит сьют на детерминированные fake timers (vi.useFakeTimers)." },
      {
        kind: "options",
        prompt: "Насколько тщательно проверить исправление?",
        options: [
          { id: "once", label: "Один запуск", description: "Быстрая проверка работоспособности." },
          { id: "stress", label: "Стресс-запуск · 50×", description: "Подтвердить, что нестабильность устранена." },
          { id: "ci", label: "Только CI", description: "Доверить проверку pipeline." },
        ],
      },
      { kind: "status", level: "ok", text: "Patch добавлен в индекс · 1 файл изменён" },
      { kind: "text", text: "Открыть PR с этим исправлением?", streaming: true },
      {
        kind: "suggested",
        actions: [
          { id: "pr", label: "Открыть PR", icon: "arrow-forward", tone: "primary" },
          { id: "rerun", label: "Перезапустить тесты", icon: "refresh" },
          { id: "copy", label: "Скопировать patch", icon: "copy" },
        ],
      },
    ],
  },
];

const releaseThread: readonly ChatMessage[] = [
  { id: "u1", role: "user", time: "15:12", text: "Собери черновик release notes для 0.1.69 по merged PR." },
  {
    id: "a1",
    role: "agent",
    time: "15:12",
    blocks: [
      { kind: "reasoning", duration: "3s", text: "Соберу merged PR после последнего тега, сгруппирую их по типам и напишу короткий changelog." },
      { kind: "command", command: "git log v0.1.68..HEAD --oneline", state: "ok", exitCode: 0, output: "cb1bf3d chore(deps): pin protobufjs\n00598a3 fix: keep Codex hook config\n7cb95e1 fix: pretrust Kanban Codex hooks" },
      { kind: "code", language: "md", code: "## 0.1.69\n- fix: keep Codex hook config before resume\n- fix: pretrust Kanban Codex hooks\n- chore(deps): pin protobufjs to 7.5.8" },
      { kind: "text", text: "Черновик готов. Открыть PR с обновлением CHANGELOG.md?", streaming: true },
      { kind: "suggested", actions: [{ id: "pr", label: "Открыть PR", icon: "arrow-forward", tone: "primary" }, { id: "copy", label: "Копировать", icon: "copy" }] },
    ],
  },
];

/** Generic thread for conversations without a bespoke script. */
export function genericThread(title: string): ChatMessage[] {
  return [
    { id: "u1", role: "user", time: "·", text: title },
    {
      id: "a1",
      role: "agent",
      time: "·",
      blocks: [
        { kind: "reasoning", duration: "2s", text: `Уточняю задачу “${title}” — собираю контекст из workspace перед действиями.` },
        { kind: "text", text: `Принял. Поработаю над “${title}” и вернусь с конкретными изменениями.` },
        { kind: "suggested", actions: [{ id: "go", label: "Продолжить", tone: "primary" }, { id: "scope", label: "Уточнить scope" }] },
      ],
    },
  ];
}

/** Empty starter thread for a freshly created chat. */
export function starterThread(): ChatMessage[] {
  return [];
}

export const initialChats: readonly ConversationSummary[] = [
  { id: "chat-2", title: "Release notes для 0.1.69", snippet: "Пишет changelog…", time: "15:12", status: "running", agent: "codex", profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" }, unread: true },
  { id: "chat-3", title: "Postgres или SQLite для нас", snippet: "Ждёт ввод: ожидаемый QPS?", time: "14:05", status: "waiting", agent: "gemini", profile: { agent: "gemini", model: "gemini-2.5-flash", reasoning: "default", mode: "default" }, unread: true },
  { id: "chat-1", title: "Объясни auth flow", snippet: "Разобрал жизненный цикл токена", time: "13:40", status: "done", agent: "claude-code", profile: { agent: "claude-code", model: "default", reasoning: "default", mode: "default" } },
  { id: "chat-5", title: "Сводка incident #4127", snippet: "Не удалось получить bundle логов", time: "Mon", status: "error", agent: "claude-code", profile: { agent: "claude-code", model: "default", reasoning: "default", mode: "default" } },
  { id: "chat-4", title: "Идеи текста onboarding", snippet: "Черновик сохранён", time: "Mon", status: "idle", agent: "opencode", profile: { agent: "opencode", model: "default", reasoning: "default", mode: "default" } },
];

export const initialProjects: readonly Project[] = [
  {
    id: "auth-service",
    name: "auth-service",
    path: "/root/workspace/rlab",
    conversations: [
      { id: "c-flaky", title: "Flaky-тест auth.login", snippet: "Сьют переведён на fake timers", time: "14:02", status: "running", agent: "claude-code", profile: { agent: "claude-code", model: "default", reasoning: "default", mode: "default" }, unread: true },
      { id: "c-jwt", title: "Ротация JWT-секретов", snippet: "Ждёт подтверждение deploy", time: "11:20", status: "waiting", agent: "codex", profile: { agent: "codex", model: "gpt-5.5", reasoning: "default", mode: "default" } },
      { id: "c-rl", title: "Rate-limit middleware", snippet: "Отгружено · 6 файлов изменено", time: "Mon", status: "done", agent: "claude-code", profile: { agent: "claude-code", model: "default", reasoning: "default", mode: "default" } },
    ],
  },
  {
    id: "web-ui",
    name: "web-ui",
    path: "/root/workspace/rlab/next-ui",
    conversations: [
      { id: "c-theme", title: "Токены dark/light темы", snippet: "Все токены перенесены", time: "Tue", status: "done", agent: "opencode", profile: { agent: "opencode", model: "default", reasoning: "default", mode: "default" } },
      { id: "c-virt", title: "Виртуализация списка board", snippet: "Черновик — не начато", time: "Tue", status: "idle", agent: "gemini", profile: { agent: "gemini", model: "gemini-2.5-pro", reasoning: "default", mode: "default" } },
      { id: "c-toast", title: "Починить stacking тостов", snippet: "Ошибка сборки на шаге CI 3", time: "Mon", status: "error", agent: "codex", profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" } },
    ],
  },
  {
    id: "infra",
    name: "infra",
    path: "/root/workspace/rlab",
    conversations: [
      { id: "c-tf", title: "Terraform drift", snippet: "Ждёт ввод: 2 ресурса на destroy", time: "Wed", status: "waiting", agent: "codex", profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" }, unread: true },
      { id: "c-node", title: "Обновить Node до 22", snippet: "В очереди после release", time: "Wed", status: "idle", agent: "claude-code", profile: { agent: "claude-code", model: "default", reasoning: "default", mode: "plan" } },
    ],
  },
];

/** Bespoke threads by conversation id; everything else falls back to generic. */
export const scriptedThreads: Record<string, readonly ChatMessage[]> = {
  "c-flaky": flakyThread,
  "chat-2": releaseThread,
};

/** Build the initial thread map for all seeded conversations. */
export function buildInitialThreads(): Record<string, ChatMessage[]> {
  const all: ConversationSummary[] = [...initialChats, ...initialProjects.flatMap((p) => p.conversations)];
  const threads: Record<string, ChatMessage[]> = {};
  for (const conv of all) {
    const scripted = scriptedThreads[conv.id];
    // Sample threads reuse local message ids ("u1"/"a1"); namespace them per
    // conversation so they stay globally unique once persisted (messages.id is a
    // primary key in the SQLite store — colliding ids break demo seeding).
    threads[conv.id] = (scripted ?? genericThread(conv.title)).map((message) => ({ ...message, id: `${conv.id}-${message.id}` }));
  }
  return threads;
}

export function nowLabel(): string {
  return formatClock24();
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
