import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import { Box, Stack, type SxProps, type Theme, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { Highlight, type PrismTheme } from "prism-react-renderer";
import { memo, useMemo, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { DiffBlock, ReviewCommentEntry } from "../../agent";
import { AttachmentTile } from "../../agent/composer/AttachmentTile";
import { InlineDraftEditor } from "../../agent/composer/InlineDraftEditor";
import type { ComposerStore } from "../../agent/composer/composer-store";
import { parseUserDraft } from "../../agent/message/message-content-model";
import { IconButton } from "../../ui";
import { DiffCommentRowStore, GitDiffLinesStore } from "./git-diff-viewer-store";

type DiffViewerLineKind = "add" | "del" | "ctx" | "meta";

export interface DiffViewerLine {
  readonly kind: DiffViewerLineKind;
  readonly text: string;
}

type HighlightToken = { readonly content: string; readonly types: string[]; readonly empty?: boolean };
type KeyedDiffViewerLine = { readonly key: string; readonly line: DiffViewerLine; readonly lineNo: number; readonly tokenRow?: number };
type KeyedHighlightToken = { readonly key: string; readonly token: HighlightToken };

function keyedDiffViewerLines(lines: readonly DiffViewerLine[]): readonly KeyedDiffViewerLine[] {
  const keyed: KeyedDiffViewerLine[] = [];
  let lineNo = 1;
  let tokenRow = 0;
  for (const line of lines) {
    const highlighted = line.kind !== "meta";
    keyed.push({ key: `${lineNo}:${line.kind}:${line.text}`, line, lineNo, ...(highlighted ? { tokenRow } : {}) });
    if (highlighted) {
      tokenRow += 1;
    }
    lineNo += 1;
  }
  return keyed;
}

function keyedHighlightTokens(lineNo: number, tokens: readonly HighlightToken[]): readonly KeyedHighlightToken[] {
  const keyed: KeyedHighlightToken[] = [];
  let offset = 0;
  let index = 0;
  for (const token of tokens) {
    keyed.push({ key: `${lineNo}:${index}:${offset}:${token.types.join(".")}`, token });
    offset += token.content.length;
    index += 1;
  }
  return keyed;
}

function unifiedLineKind(line: string): DiffViewerLineKind {
  if (line.startsWith("@@") || line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
    return "meta";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "del";
  }
  return "ctx";
}

export function gitDiffViewerLinesFromUnified(diff: string): readonly DiffViewerLine[] {
  return diff
    .split(/\r?\n/)
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .map((line) => ({ kind: unifiedLineKind(line), text: line }));
}

export function gitDiffViewerLinesFromBlock(block: DiffBlock): readonly DiffViewerLine[] {
  return block.lines.map((line) => {
    const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
    return { kind: line.type, text: `${prefix}${line.text}` };
  });
}

export function countDiffChanges(lines: readonly DiffViewerLine[]): { readonly additions: number; readonly deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === "add") {
      additions += 1;
    } else if (line.kind === "del") {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

// The diff marker (+/-/space) lives on `text` for kind detection but is not
// shown; meta (hunk header) lines are rendered verbatim and never highlighted.
function lineContent(line: DiffViewerLine): string {
  return line.kind === "meta" ? line.text : line.text.slice(1);
}

const PRISM_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
};

function prismLanguageForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return PRISM_LANGUAGE_BY_EXTENSION[ext] ?? "plaintext";
}

// GitHub-dark-ish token palette over transparent rows so each line keeps its
// own add/del background tint.
const diffSyntaxTheme: PrismTheme = {
  plain: { color: "#c9d1d9", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "#8b949e", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "#8b949e" } },
    { types: ["keyword", "selector", "tag", "operator", "rule"], style: { color: "#ff7b72" } },
    { types: ["string", "char", "attr-value", "regex", "url"], style: { color: "#a5d6ff" } },
    { types: ["number", "boolean", "constant", "symbol", "inserted"], style: { color: "#79c0ff" } },
    { types: ["function", "function-name"], style: { color: "#d2a8ff" } },
    { types: ["class-name", "maybe-class-name", "builtin"], style: { color: "#ffa657" } },
    { types: ["property", "attr-name", "variable", "parameter"], style: { color: "#79c0ff" } },
    { types: ["deleted"], style: { color: "#ffa198" } },
  ],
};

function rowBackground(kind: DiffViewerLineKind): SxProps<Theme> {
  switch (kind) {
    case "add":
      return { backgroundColor: (theme) => theme.palette.status.ok.soft };
    case "del":
      return { backgroundColor: (theme) => theme.palette.status.error.soft };
    case "meta":
      return { backgroundColor: (theme) => theme.custom.surfaces.s2 };
    case "ctx":
      return { backgroundColor: "transparent" };
  }
}

function accentColor(kind: DiffViewerLineKind): (theme: Theme) => string {
  return (theme) => {
    switch (kind) {
      case "add":
        return theme.palette.status.ok.main;
      case "del":
        return theme.palette.status.error.main;
      default:
        return "transparent";
    }
  };
}

function gutterColor(kind: DiffViewerLineKind): (theme: Theme) => string {
  return (theme) => {
    switch (kind) {
      case "add":
        return theme.palette.status.ok.main;
      case "del":
        return theme.palette.status.error.main;
      default:
        return theme.palette.text.secondary;
    }
  };
}

const GitDiffHighlightedLines = memo(function GitDiffHighlightedLines({
  code,
  language,
  keyedLines,
  interactive,
  commentsByLine,
  store,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onInputActivityChange,
}: {
  readonly code: string;
  readonly language: string;
  readonly keyedLines: readonly KeyedDiffViewerLine[];
  readonly interactive: boolean;
  readonly commentsByLine: ReadonlyMap<number, readonly ReviewCommentEntry[]>;
  readonly store: GitDiffLinesStore;
  readonly onAddComment?: (line: number, lineText: string, body: string) => void;
  readonly onUpdateComment?: (id: string, body: string) => void;
  readonly onDeleteComment?: (id: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
}) {
  return (
    <Highlight code={code} language={language} theme={diffSyntaxTheme}>
      {({ tokens, getTokenProps }) => (
        <Box
          component="ol"
          sx={{
            m: 0,
            p: 0,
            listStyle: "none",
            overflowX: "hidden",
            fontFamily: (theme) => theme.custom.fonts.mono,
            fontSize: "0.72rem",
            lineHeight: 1.55,
          }}
        >
          {keyedLines.map(({ key, line, lineNo, tokenRow }) => (
            <GitDiffLineRow
              key={key}
              line={line}
              lineNo={lineNo}
              tokens={tokenRow === undefined ? [] : (tokens[tokenRow] ?? [])}
              getTokenProps={getTokenProps}
              comments={commentsByLine.get(lineNo) ?? []}
              interactive={interactive}
              store={store}
              onAddComment={onAddComment}
              onUpdateComment={onUpdateComment}
              onDeleteComment={onDeleteComment}
              onInputActivityChange={onInputActivityChange}
            />
          ))}
        </Box>
      )}
    </Highlight>
  );
});

const GitDiffLineRow = observer(function GitDiffLineRow({
  line,
  lineNo,
  tokens,
  getTokenProps,
  comments,
  interactive,
  store,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onInputActivityChange,
}: {
  readonly line: DiffViewerLine;
  readonly lineNo: number;
  readonly tokens: readonly HighlightToken[];
  readonly getTokenProps: (input: { readonly token: HighlightToken }) => Record<string, unknown>;
  readonly comments: readonly ReviewCommentEntry[];
  readonly interactive: boolean;
  readonly store: GitDiffLinesStore;
  readonly onAddComment?: (line: number, lineText: string, body: string) => void;
  readonly onUpdateComment?: (id: string, body: string) => void;
  readonly onDeleteComment?: (id: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
}) {
  const composing = store.activeLine === lineNo;
  const newCommentDraftStoreKey = `new:${lineNo}:${line.text}`;
  const newCommentDraftStore = composing ? store.draftStore(newCommentDraftStoreKey) : undefined;
  return (
    <Box component="li">
      <Box
        onClick={interactive ? () => store.setActiveLine((current) => (current === lineNo ? null : lineNo)) : undefined}
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(2.75rem, max-content) 1fr",
          alignItems: "start",
          borderLeft: (theme) => `2px solid ${accentColor(line.kind)(theme)}`,
          cursor: interactive ? "pointer" : "default",
          ...rowBackground(line.kind),
          ...(interactive ? { "&:hover": { boxShadow: (theme) => `inset 0 0 0 1px ${theme.palette.status.info.border}` } } : {}),
        }}
      >
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            userSelect: "none",
            textAlign: "right",
            px: 1,
            color: gutterColor(line.kind),
            fontWeight: line.kind === "add" || line.kind === "del" ? 600 : 400,
            opacity: line.kind === "ctx" ? 0.6 : 1,
            borderRight: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          }}
        >
          {lineNo}
        </Box>
        <Box component="span" sx={{ px: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word", color: line.kind === "meta" ? "text.tertiary" : undefined }}>
          {line.kind === "meta"
            ? line.text
            : keyedHighlightTokens(lineNo, tokens).map(({ key, token }) => {
                const props = getTokenProps({ token });
                return <span key={key} {...props} />;
              })}
        </Box>
      </Box>
      {(comments.length > 0 || composing) && (
        <DiffCommentThread
          comments={comments}
          composing={composing}
          newCommentStore={newCommentDraftStore}
          onAdd={(body) => {
            onAddComment?.(lineNo, lineContent(line), body);
            store.removeDraftStore(newCommentDraftStoreKey);
            store.setActiveLine(null);
          }}
          onCancel={() => {
            store.removeDraftStore(newCommentDraftStoreKey);
            store.setActiveLine(null);
          }}
          onUpdate={onUpdateComment}
          onDelete={onDeleteComment}
          onInputActivityChange={onInputActivityChange}
        />
      )}
    </Box>
  );
});

/** GitDiffLines — a line-numbered, syntax-highlighted unified diff body. Lines
 *  wrap inside the container (no horizontal scroll) and the list grows to fit
 *  its content (the surrounding panel owns the scroll). Added/removed rows carry
 *  a bright coloured gutter number and left accent border. */
export function GitDiffLines({
  lines,
  path,
  comments = [],
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onInputActivityChange,
}: {
  readonly lines: readonly DiffViewerLine[];
  readonly path?: string;
  readonly comments?: readonly ReviewCommentEntry[];
  readonly onAddComment?: (line: number, lineText: string, body: string) => void;
  readonly onUpdateComment?: (id: string, body: string) => void;
  readonly onDeleteComment?: (id: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
}) {
  const keyedLines = useMemo(() => keyedDiffViewerLines(lines), [lines]);
  const code = useMemo(() => keyedLines.filter(({ line }) => line.kind !== "meta").map(({ line }) => lineContent(line)).join("\n"), [keyedLines]);
  const language = useMemo(() => prismLanguageForPath(path ?? ""), [path]);
  const interactive = Boolean(onAddComment);
  const [store] = useState(() => new GitDiffLinesStore());
  const commentsByLine = useMemo(() => {
    const map = new Map<number, readonly ReviewCommentEntry[]>();
    for (const comment of comments) {
      const list = map.get(comment.line) ?? [];
      map.set(comment.line, [...list, comment]);
    }
    return map;
  }, [comments]);

  return (
    <GitDiffHighlightedLines
      code={code}
      language={language}
      keyedLines={keyedLines}
      interactive={interactive}
      commentsByLine={commentsByLine}
      store={store}
      onAddComment={onAddComment}
      onUpdateComment={onUpdateComment}
      onDeleteComment={onDeleteComment}
      onInputActivityChange={onInputActivityChange}
    />
  );
}

/** The comments anchored to one diff line, plus an inline composer when the user
 *  is adding a new one. */
function DiffCommentThread({
  comments,
  composing,
  onAdd,
  onCancel,
  onUpdate,
  onDelete,
  onInputActivityChange,
  newCommentStore,
}: {
  readonly comments: readonly ReviewCommentEntry[];
  readonly composing: boolean;
  readonly newCommentStore?: ComposerStore;
  readonly onAdd: (body: string) => void;
  readonly onCancel: () => void;
  readonly onUpdate?: (id: string, body: string) => void;
  readonly onDelete?: (id: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
}) {
  return (
    <Stack spacing={0.75} sx={{ px: 1.5, py: 1, borderLeft: (theme) => `2px solid ${theme.palette.status.info.border}`, backgroundColor: (theme) => theme.custom.surfaces.s2 }}>
      {comments.map((comment) => (
        <DiffCommentRow key={comment.id} comment={comment} onUpdate={onUpdate} onDelete={onDelete} onInputActivityChange={onInputActivityChange} />
      ))}
      {composing && <DiffCommentComposer onSubmit={onAdd} onCancel={onCancel} onInputActivityChange={onInputActivityChange} store={newCommentStore} />}
    </Stack>
  );
}

function DiffCommentBody({ body }: { readonly body: string }) {
  const draft = useMemo(() => parseUserDraft(body), [body]);
  return (
    <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
      {draft.text && (
        <Typography sx={{ fontFamily: (theme) => theme.custom.fonts.sans, fontSize: "0.8rem", color: "text.primary", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {draft.text}
        </Typography>
      )}
      {draft.attachments.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
          {draft.attachments.map((attachment) => (
            <AttachmentTile key={attachment.id} name={attachment.name} mime={attachment.type} sizeBytes={attachment.size} />
          ))}
        </Box>
      )}
    </Stack>
  );
}

const DiffCommentRow = observer(function DiffCommentRow({
  comment,
  onUpdate,
  onDelete,
  onInputActivityChange,
}: {
  readonly comment: ReviewCommentEntry;
  readonly onUpdate?: (id: string, body: string) => void;
  readonly onDelete?: (id: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
}) {
  const { t } = useI18n();
  const [store] = useState(() => new DiffCommentRowStore());
  const { editing, setEditing } = store;

  if (editing) {
    const initialDraft = parseUserDraft(comment.body);
    return (
      <DiffCommentComposer
        initial={comment.body}
        onSubmit={(body) => {
          onUpdate?.(comment.id, body);
          store.clearDraftStore();
          setEditing(false);
        }}
        onCancel={() => {
          store.clearDraftStore();
          setEditing(false);
        }}
        onInputActivityChange={onInputActivityChange}
        store={store.draftStore(initialDraft.text, initialDraft.attachments)}
      />
    );
  }

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "flex-start" }}>
      <DiffCommentBody body={comment.body} />
      {onUpdate && (
        <IconButton size="small" aria-label={t("reviewEditComment")} onClick={() => setEditing(true)} sx={{ width: 24, height: 24 }}>
          <EditIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
      {onDelete && (
        <IconButton size="small" aria-label={t("reviewDeleteComment")} onClick={() => onDelete(comment.id)} sx={{ width: 24, height: 24 }}>
          <DeleteOutlineIcon sx={{ fontSize: 15 }} />
        </IconButton>
      )}
    </Stack>
  );
});

const DiffCommentComposer = observer(function DiffCommentComposer({
  initial = "",
  onSubmit,
  onCancel,
  onInputActivityChange,
  store,
}: {
  readonly initial?: string;
  readonly onSubmit: (body: string) => void;
  readonly onCancel: () => void;
  readonly onInputActivityChange?: (active: boolean) => void;
  readonly store?: ComposerStore;
}) {
  const { t } = useI18n();
  const initialDraft = useMemo(() => parseUserDraft(initial), [initial]);

  return (
    <Stack spacing={0.75}>
      <InlineDraftEditor
        ariaLabel={t("reviewCommentPlaceholder")}
        initialText={initialDraft.text}
        initialAttachments={initialDraft.attachments}
        placeholder={t("reviewCommentPlaceholder")}
        onSubmit={onSubmit}
        onCancel={onCancel}
        cancelLabel={t("cancel")}
        onInputActivityChange={onInputActivityChange}
        submitLabel={t("reviewSaveComment")}
        submitShortcut="mod-enter"
        inputRows={2}
        minHeight={68}
        maxHeight={260}
        testIdPrefix="git-comment"
        inputSx={{
          border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          fontFamily: (theme) => theme.custom.fonts.sans,
          fontSize: "0.82rem",
          lineHeight: 1.45,
          p: 0.75,
          "&:focus": { borderColor: (theme) => theme.custom.borders.focus },
        }}
        actionsSx={{ gap: 0.25 }}
        actionButtonSx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.74rem" }}
        store={store}
      />
    </Stack>
  );
});
