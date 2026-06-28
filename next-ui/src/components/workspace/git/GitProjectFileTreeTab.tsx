import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import {
  buildGitProjectFileTree,
  firstGitProjectFilePath,
  gitProjectFileTreeDirectoryPaths,
  type GitProjectFileTreeNode,
} from "./git-project-file-tree-model";

const ROOT_PATH = "";
const ROW_HEIGHT = 30;
const INDENT_WIDTH = 22;

function projectRootName(cwd?: string): string {
  const normalized = (cwd ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const name = normalized.split("/").filter(Boolean).at(-1);
  return name || cwd || "/";
}

export function GitProjectFileTreeTab({
  cwd,
  files,
  loading,
  error,
  t,
}: {
  readonly cwd?: string;
  readonly files: readonly string[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly t: I18nApi["t"];
}) {
  const tree = useMemo(() => buildGitProjectFileTree(files), [files]);
  const directoryPaths = useMemo(() => gitProjectFileTreeDirectoryPaths(tree), [tree]);
  const directoryKey = directoryPaths.join("\0");
  const firstFilePath = useMemo(() => firstGitProjectFilePath(tree), [tree]);
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set([ROOT_PATH]));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const rootExpanded = expandedPaths.has(ROOT_PATH);
  const effectiveSelectedPath = selectedPath ?? firstFilePath;

  useEffect(() => {
    setExpandedPaths(new Set([ROOT_PATH, ...directoryPaths]));
  }, [directoryKey, directoryPaths]);

  useEffect(() => {
    setSelectedPath((current) => (current && files.includes(current) ? current : null));
  }, [files]);

  const toggleDirectory = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderNode = (node: GitProjectFileTreeNode, depth: number): ReactNode => {
    if (node.type === "directory") {
      const expanded = expandedPaths.has(node.path);
      return (
        <Box key={node.path}>
          <FileTreeRow
            label={node.name}
            depth={depth}
            directory
            expanded={expanded}
            onClick={() => toggleDirectory(node.path)}
            t={t}
          />
          {expanded && node.children.map((child) => renderNode(child, depth + 1))}
        </Box>
      );
    }
    const selected = node.path === effectiveSelectedPath;
    return (
      <FileTreeRow
        key={node.path}
        label={node.name}
        depth={depth}
        path={node.path}
        selected={selected}
        onClick={() => setSelectedPath(node.path)}
        t={t}
      />
    );
  };

  if (loading && files.length === 0) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
        <CircularProgress size={16} />
        <Typography>{t("gitProjectFilesLoading")}</Typography>
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (tree.length === 0) {
    return <Alert severity="info">{t("gitProjectFilesEmpty")}</Alert>;
  }

  return (
    <Stack spacing={0.75} sx={{ minHeight: 0 }}>
      {loading && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary", px: 0.5 }}>
          <CircularProgress size={14} />
          <Typography sx={{ fontSize: "0.76rem" }}>{t("gitProjectFilesLoading")}</Typography>
        </Stack>
      )}
      <Box
        role="tree"
        data-testid="git-project-file-tree"
        aria-label={t("gitFilesTab")}
        sx={{
          minWidth: 0,
          color: "text.primary",
          fontSize: "0.82rem",
        }}
      >
        <FileTreeRow
          label={projectRootName(cwd)}
          depth={0}
          directory
          expanded={rootExpanded}
          onClick={() => toggleDirectory(ROOT_PATH)}
          t={t}
        />
        {rootExpanded && tree.map((node) => renderNode(node, 1))}
      </Box>
    </Stack>
  );
}

function FileTreeRow({
  label,
  depth,
  path,
  directory = false,
  expanded,
  selected = false,
  onClick,
  t,
}: {
  readonly label: string;
  readonly depth: number;
  readonly path?: string;
  readonly directory?: boolean;
  readonly expanded?: boolean;
  readonly selected?: boolean;
  readonly onClick: () => void;
  readonly t: I18nApi["t"];
}) {
  const title = path ? `${path}` : label;
  return (
    <Box
      component="button"
      type="button"
      role="treeitem"
      aria-label={label}
      aria-expanded={directory ? Boolean(expanded) : undefined}
      aria-selected={directory ? undefined : selected}
      title={title}
      onClick={onClick}
      sx={{
        width: "100%",
        height: ROW_HEIGHT,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        pl: `${depth * INDENT_WIDTH + (directory ? 0 : INDENT_WIDTH)}px`,
        pr: 1,
        border: 0,
        borderRadius: (theme) => `${theme.custom.radii.sm}px`,
        backgroundColor: (theme) => (selected ? theme.custom.surfaces.s3 : "transparent"),
        color: directory ? "text.primary" : selected ? "text.primary" : "text.secondary",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
        transition: "background-color 120ms ease, color 120ms ease",
        "&:hover": {
          backgroundColor: (theme) => (selected ? theme.custom.surfaces.s3 : theme.custom.surfaces.s2),
          color: "text.primary",
        },
      }}
    >
      {directory ? (
        <Box component="span" aria-hidden="true" sx={{ width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", color: "text.secondary" }}>
          {expanded ? <KeyboardArrowDownRoundedIcon sx={{ fontSize: 20 }} /> : <KeyboardArrowRightRoundedIcon sx={{ fontSize: 20 }} />}
        </Box>
      ) : (
        <InsertDriveFileOutlinedIcon aria-label={t("gitProjectFile")} sx={{ width: 18, height: 18, fontSize: 17, flex: "0 0 auto", color: "text.tertiary" }} />
      )}
      <Typography
        component="span"
        noWrap
        sx={{
          minWidth: 0,
          flex: 1,
          fontSize: directory ? "0.84rem" : "0.8rem",
          fontWeight: directory ? 650 : 500,
          color: "inherit",
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
