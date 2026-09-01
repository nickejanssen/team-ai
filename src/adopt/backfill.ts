// Deterministic. No model calls. No network.
//
// applyFrontmatter prepends an inferred FrontMatter block to a markdown file
// that has none. It never deletes and never rewrites: a file that already opens
// with `---` is left exactly as it was and reported back as a no-op.

import { readFileSync, writeFileSync } from "node:fs";

import { serializeFrontmatter } from "../kb/frontmatter.js";
import type { FrontMatter } from "../schema/types.js";

export interface ApplyFrontmatterOptions {
  dryRun?: boolean;
}

export interface ApplyFrontmatterResult {
  ok: boolean;
  reason?: string;
  content?: string;
}

export function applyFrontmatter(
  absPath: string,
  fm: FrontMatter,
  opts: ApplyFrontmatterOptions,
): ApplyFrontmatterResult {
  const raw = readFileSync(absPath, "utf8");
  if (raw.startsWith("---\n")) return { ok: false, reason: "already has front matter" };

  const content = serializeFrontmatter(fm as unknown as Record<string, unknown>, raw);
  if (opts.dryRun === true) return { ok: true, content };

  writeFileSync(absPath, content, "utf8");
  return { ok: true };
}
