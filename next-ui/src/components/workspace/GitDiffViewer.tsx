import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import { Box, Stack, type SxProps, type Theme, Typography } from "@mui/material";
import { Highlight, type PrismTheme } from "prism-react-renderer";
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { type DiffBlock, type ReviewCommentEntry } from "../agent";
import { Button, IconButton } from "../ui";

type DiffViewerLineKind = "add" | "del" | "ctx" | "meta";

export interface DiffViewerLine {
  readonly kind: DiffViewerLineKind;
  readonly text: string;
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
}: {
  readonly lines: readonly DiffViewerLine[];
  readonly path?: string;
  readonly comments?: readonly ReviewCommentEntry[];
  readonly onAddComment?: (line: number, lineText: string, body: string) => void;
  readonly onUpdateComment?: (id: string, body: string) => void;
  readonly onDeleteComment?: (id: string) => void;
}) {
  const code = lines.map(lineContent).join("\n");
  const language = prismLanguageForPath(path ?? "");
  const interactive = Boolean(onAddComment);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const commentsByLine = useMemo(() => {
    const map = new Map<number, ReviewCommentEntry[]>();
    for (const comment of comments) {
      const list = map.get(comment.line) ?? [];
      list.push(comment);
      map.set(comment.line, list);
    }
    return map;
  }, [comments]);

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
          {lines.map((line, index) => {
            const lineNo = index + 1;
            const lineComments = commentsByLine.get(lineNo) ?? [];
            const composing = activeLine === lineNo;
            return (
              <Box component="li" key={`${index}-${line.kind}`}>
                <Box
                  onClick={interactive ? () => setActiveLine((current) => (current === lineNo ? null : lineNo)) : undefined}
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
                      : (tokens[index] ?? []).map((token, tokenIndex) => {
                          const props = getTokenProps({ token });
                          return <span key={tokenIndex} {...props} />;
                        })}
                  </Box>
                </Box>
                {(lineComments.length > 0 || composing) && (
                  <DiffCommentThread
                    comments={lineComments}
                    composing={composing}
                    onAdd={(body) => {
                      onAddComment?.(lineNo, lineContent(line), body);
                      setActiveLine(null);
                    }}
                    onCancel={() => setActiveLine(null)}
                    onUpdate={onUpdateComment}
                    onDelete={onDeleteComment}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Highlight>
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
}: {
  readonly comments: readonly ReviewCommentEntry[];
  readonly composing: boolean;
  readonly onAdd: (body: string) => void;
  readonly onCancel: () => void;
  readonly onUpdate?: (id: string, body: string) => void;
  readonly onDelete?: (id: string) => void;
}) {
  return (
    <Stack spacing={0.75} sx={{ px: 1.5, py: 1, borderLeft: (theme) => `2px solid ${theme.palette.status.info.border}`, backgroundColor: (theme) => theme.custom.surfaces.s2 }}>
      {comments.map((comment) => (
        <DiffCommentRow key={comment.id} comment={comment} onUpdate={onUpdate} onDelete={onDelete} />
      ))}
      {composing && <DiffCommentComposer onSubmit={onAdd} onCancel={onCancel} />}
    </Stack>
  );
}

function DiffCommentRow({
  comment,
  onUpdate,
  onDelete,
}: {
  readonly comment: ReviewCommentEntry;
  readonly onUpdate?: (id: string, body: string) => void;
  readonly onDelete?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <DiffCommentComposer
        initial={comment.body}
        onSubmit={(body) => {
          onUpdate?.(comment.id, body);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "flex-start" }}>
      <Typography sx={{ flex: 1, minWidth: 0, fontFamily: (theme) => theme.custom.fonts.sans, fontSize: "0.8rem", color: "text.primary", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {comment.body}
      </Typography>
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
}

function DiffCommentComposer({
  initial = "",
  onSubmit,
  onCancel,
}: {
  readonly initial?: string;
  readonly onSubmit: (body: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const submit = () => {
    const body = draft.trim();
    if (body.length > 0) {
      onSubmit(body);
      setDraft("");
    }
  };

  return (
    <Stack spacing={0.75}>
      <Box
        component="textarea"
        autoFocus
        aria-label={t("reviewCommentPlaceholder")}
        placeholder={t("reviewCommentPlaceholder")}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        rows={2}
        sx={{
          width: "100%",
          resize: "vertical",
          border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          borderRadius: (theme) => `${theme.custom.radii.md}px`,
          bgcolor: (theme) => theme.custom.surfaces.s1,
          color: "text.primary",
          font: "inherit",
          fontFamily: (theme) => theme.custom.fonts.sans,
          fontSize: "0.82rem",
          lineHeight: 1.45,
          p: 0.75,
          outline: 0,
          "&:focus": { borderColor: (theme) => theme.custom.borders.focus },
        }}
      />
      <Stack direction="row" spacing={0.75} sx={{ justifyContent: "flex-end" }}>
        <Button variant="subtle" size="small" onClick={onCancel} sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.74rem" }}>
          {t("cancel")}
        </Button>
        <Button variant="contained" size="small" disabled={draft.trim().length === 0} onClick={submit} sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.74rem" }}>
          {t("reviewSaveComment")}
        </Button>
      </Stack>
    </Stack>
  );
}
