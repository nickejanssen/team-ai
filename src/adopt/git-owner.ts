// Deterministic. No model calls. No network.
//
// Reads `git log` author names so front-matter inference can pick a
// most-frequent owner. Never throws: an untracked file, a missing repo, or a
// git binary that is not on PATH all resolve to an empty list / empty map.
//
// `getGitAuthorsMap` does the whole directory in ONE `git log` traversal.
// Spawning `git log` once per file is O(files) subprocesses — on a real repo
// (hundreds of docs) that alone runs for minutes, so the batch form is what
// `buildAdoptionPlan` uses; `getGitAuthors` remains for single-path callers.

import { execFileSync } from "node:child_process";

const REC = "\x1e"; // record separator — starts every commit's author line

function runGitLog(repoRoot: string, extraArgs: string[]): string | null {
  try {
    return execFileSync(
      "git",
      ["-c", "core.quotepath=false", "-C", repoRoot, "log", ...extraArgs],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
}

export function getGitAuthors(filePath: string, repoRoot: string): string[] {
  const out = runGitLog(repoRoot, ["--format=%an", "--", filePath]);
  if (out === null) return [];
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * One `git log --name-only` pass over `scopeRelPath` (a repo-relative directory,
 * or "." for the whole repo). Returns a map from repo-relative POSIX path to the
 * commit authors that touched it, newest first, one entry per commit (so
 * `inferOwner` can still count frequency). Paths not in git are simply absent.
 */
export function getGitAuthorsMap(repoRoot: string, scopeRelPath: string): Map<string, string[]> {
  const scope = scopeRelPath.length > 0 ? scopeRelPath : ".";
  const out = runGitLog(repoRoot, [`--format=${REC}%an`, "--name-only", "--", scope]);
  const map = new Map<string, string[]>();
  if (out === null) return map;

  let currentAuthor: string | null = null;
  for (const rawLine of out.split(/\r?\n/)) {
    if (rawLine.startsWith(REC)) {
      currentAuthor = rawLine.slice(REC.length).trim();
      continue;
    }
    const path = rawLine.trim();
    if (path.length === 0 || currentAuthor === null) continue;
    const existing = map.get(path);
    if (existing) existing.push(currentAuthor);
    else map.set(path, [currentAuthor]);
  }
  return map;
}
