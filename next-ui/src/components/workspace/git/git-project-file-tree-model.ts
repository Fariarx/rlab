export type GitProjectFileTreeNode = GitProjectFileTreeDirectory | GitProjectFileTreeFile;

export interface GitProjectFileTreeDirectory {
  readonly type: "directory";
  readonly name: string;
  readonly path: string;
  readonly children: readonly GitProjectFileTreeNode[];
}

export interface GitProjectFileTreeFile {
  readonly type: "file";
  readonly name: string;
  readonly path: string;
}

interface MutableDirectory {
  readonly type: "directory";
  readonly name: string;
  readonly path: string;
  readonly children: Map<string, MutableNode>;
}

interface MutableFile {
  readonly type: "file";
  readonly name: string;
  readonly path: string;
}

type MutableNode = MutableDirectory | MutableFile;

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function compareTreeNodes(left: GitProjectFileTreeNode, right: GitProjectFileTreeNode): number {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
}

function immutableDirectory(node: MutableDirectory): GitProjectFileTreeDirectory {
  const children = Array.from(node.children.values())
    .map((child): GitProjectFileTreeNode => (child.type === "directory" ? immutableDirectory(child) : child))
    .sort(compareTreeNodes);
  return { type: "directory", name: node.name, path: node.path, children };
}

export function buildGitProjectFileTree(paths: readonly string[]): readonly GitProjectFileTreeNode[] {
  const root: MutableDirectory = { type: "directory", name: "", path: "", children: new Map() };
  for (const rawPath of paths) {
    const path = normalizeProjectPath(rawPath);
    if (!path) {
      continue;
    }
    const parts = path.split("/").filter(Boolean);
    let directory = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const childPath = parts.slice(0, index + 1).join("/");
      const leaf = index === parts.length - 1;
      if (leaf) {
        directory.children.set(part, { type: "file", name: part, path: childPath });
        continue;
      }
      const current = directory.children.get(part);
      if (current?.type === "directory") {
        directory = current;
        continue;
      }
      const next: MutableDirectory = { type: "directory", name: part, path: childPath, children: new Map() };
      directory.children.set(part, next);
      directory = next;
    }
  }
  return immutableDirectory(root).children;
}

export function gitProjectFileTreeDirectoryPaths(nodes: readonly GitProjectFileTreeNode[]): readonly string[] {
  const paths: string[] = [];
  const visit = (node: GitProjectFileTreeNode) => {
    if (node.type !== "directory") {
      return;
    }
    paths.push(node.path);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return paths;
}

export function firstGitProjectFilePath(nodes: readonly GitProjectFileTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") {
      return node.path;
    }
    const child = firstGitProjectFilePath(node.children);
    if (child) {
      return child;
    }
  }
  return null;
}
