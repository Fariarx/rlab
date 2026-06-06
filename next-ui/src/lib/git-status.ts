export interface GitFileStatus {
  readonly code: string;
  readonly gitPath: string;
  readonly label: string;
  readonly path: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
}

export interface GitStatusPayload {
  readonly branch: string;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly clean: boolean;
  readonly files: readonly GitFileStatus[];
}

function statusLabel(code: string): string {
  if (code === "??") {
    return "Untracked";
  }
  if (code.includes("U")) {
    return "Conflict";
  }
  if (code.includes("R")) {
    return "Renamed";
  }
  if (code.includes("C")) {
    return "Copied";
  }
  if (code.includes("A")) {
    return "Added";
  }
  if (code.includes("D")) {
    return "Deleted";
  }
  if (code.includes("M")) {
    return "Modified";
  }
  return "Changed";
}

function parseBranchLine(line: string): Pick<GitStatusPayload, "branch" | "upstream" | "ahead" | "behind"> {
  const content = line.replace(/^##\s*/, "").trim();
  const divergenceMatch = content.match(/\[(?<details>[^\]]+)\]$/);
  const branchPart = divergenceMatch ? content.slice(0, divergenceMatch.index).trim() : content;
  const [rawBranch, upstream] = branchPart.split("...");
  const aheadMatch = divergenceMatch?.groups?.details.match(/ahead\s+(?<count>\d+)/);
  const behindMatch = divergenceMatch?.groups?.details.match(/behind\s+(?<count>\d+)/);

  return {
    branch: rawBranch.replace(/^No commits yet on\s+/, "").trim() || "HEAD",
    upstream: upstream?.trim() || undefined,
    ahead: aheadMatch?.groups?.count ? Number(aheadMatch.groups.count) : 0,
    behind: behindMatch?.groups?.count ? Number(behindMatch.groups.count) : 0,
  };
}

export function parseGitStatusPorcelain(output: string): GitStatusPayload {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## "));
  const branch = branchLine ? parseBranchLine(branchLine) : { branch: "HEAD", ahead: 0, behind: 0, upstream: undefined };
  const files = lines
    .filter((line) => !line.startsWith("## "))
    .map((line): GitFileStatus => {
      const code = line.slice(0, 2);
      const path = line.slice(3);
      const renamePath = path.includes(" -> ") ? path.split(" -> ").at(-1) : undefined;
      return {
        code,
        gitPath: renamePath ?? path,
        label: statusLabel(code),
        path,
        staged: code !== "??" && code[0] !== " ",
        unstaged: code === "??" || code[1] !== " ",
      };
    });

  return {
    ...branch,
    clean: files.length === 0,
    files,
  };
}
