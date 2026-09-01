// Deterministic. No model calls. No network.
//
// Reads `git log` author names for a single path so front-matter inference can
// pick a most-frequent owner. Never throws: an untracked file, a missing repo,
// or a git binary that is not on PATH all resolve to an empty list.

import { execFileSync } from "node:child_process";

export function getGitAuthors(filePath: string, repoRoot: string): string[] {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "log", "--format=%an", "--", filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
