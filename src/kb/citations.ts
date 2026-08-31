// Resolve `path#heading` citation targets against a set of loaded KB docs.

import { slug } from "./chunk.js";
import type { KbDoc } from "./types.js";

export type CitationResult =
  { ok: true; doc: KbDoc; heading?: string } | { ok: false; reason: string };

// A markdown link target that looks like a KB citation: optional leading `kb/`,
// a `.md` path, and an optional `#fragment`.
const CITATION_TARGET = /^(kb\/)?[\w./-]+\.md(#[\w-]+)?$/;
const LINK_TARGET = /\]\(([^)]+)\)/g;

function stripKbPrefix(path: string): string {
  return path.startsWith("kb/") ? path.slice(3) : path;
}

export function resolveCitation(docs: KbDoc[], citation: string): CitationResult {
  const trimmed = citation.trim();
  const hashIndex = trimmed.indexOf("#");
  const rawPath = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? undefined : trimmed.slice(hashIndex + 1);

  if (rawPath.length === 0) {
    return { ok: false, reason: `citation '${citation}' has no document path` };
  }

  const path = stripKbPrefix(rawPath);
  const doc = docs.find((candidate) => candidate.path === path);
  if (!doc) {
    return { ok: false, reason: `no document at ${path}` };
  }

  if (fragment === undefined) {
    return { ok: true, doc };
  }

  const fragmentSlug = slug(fragment);
  const heading = doc.headings.find((text) => slug(text) === fragmentSlug);
  if (heading === undefined) {
    return { ok: false, reason: `no heading '${fragment}' in ${path}` };
  }
  return { ok: true, doc, heading };
}

// Extract markdown link targets that look like KB citations, deduped, in order.
export function findCitationsInText(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(LINK_TARGET)) {
    const target = match[1];
    if (target === undefined || !CITATION_TARGET.test(target) || seen.has(target)) {
      continue;
    }
    seen.add(target);
    results.push(target);
  }
  return results;
}
