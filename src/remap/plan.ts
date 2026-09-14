// Deterministic. No model calls. No network. Reads only; writes live in apply.ts.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { hasFrontmatter } from "../adopt/backfill.js";
import { parseFrontmatter } from "../kb/frontmatter.js";
import { isExcluded } from "../kb/loader.js";
import { resolveKbScope } from "../retrieval/index-lock.js";

export interface RemapMapping {
  namespaces: Record<string, string>;
  files: Record<string, string>;
}

export type RemapStatus = "remap" | "unchanged" | "skipped" | "conflict";

export interface RemapItem {
  path: string;
  status: RemapStatus;
  from_namespace: string;
  to_namespace: string;
  from_id: string;
  to_id: string;
  reason?: string;
}

export interface RemapPlan {
  kbRoot: string;
  items: RemapItem[];
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const QUOTED_OR_COMMENTED = /^(id|namespace):[ \t]*(["']|[^\r\n]*[ \t]#)/m;

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

export function rewriteId(id: string, toNamespace: string): string {
  const dot = id.indexOf(".");
  return dot === -1 ? toNamespace : `${toNamespace}${id.slice(dot)}`;
}

export function buildRemapPlan(opts: { instance: string; mapping: RemapMapping }): RemapPlan {
  const { root, exclude } = resolveKbScope(opts.instance);
  const items: RemapItem[] = [];
  const blank = { from_namespace: "", to_namespace: "", from_id: "", to_id: "" };

  for (const rel of walk(root)
    .filter((r) => !isExcluded(r, exclude))
    .sort()) {
    const raw = readFileSync(join(root, rel), "utf8");
    if (!hasFrontmatter(raw)) {
      items.push({ path: rel, status: "skipped", ...blank, reason: "no front matter" });
      continue;
    }
    let data: Record<string, unknown>;
    try {
      ({ data } = parseFrontmatter(raw));
    } catch (err) {
      const reason =
        err instanceof Error ? (err.message.split("\n")[0] ?? err.message) : String(err);
      items.push({
        path: rel,
        status: "conflict",
        ...blank,
        reason: `front matter does not parse: ${reason}`,
      });
      continue;
    }
    if (data.id === undefined && data.namespace === undefined) {
      items.push({
        path: rel,
        status: "skipped",
        ...blank,
        reason: "front matter is not KB front matter",
      });
      continue;
    }
    const fromNs = typeof data.namespace === "string" ? data.namespace : "";
    const fromId = typeof data.id === "string" ? data.id : "";
    const base = { path: rel, from_namespace: fromNs, from_id: fromId };
    if (fromNs === "" || fromId === "") {
      items.push({
        ...base,
        status: "conflict",
        to_namespace: "",
        to_id: "",
        reason: "missing id or namespace",
      });
      continue;
    }
    if (QUOTED_OR_COMMENTED.test(FRONT_MATTER.exec(raw)?.[1] ?? "")) {
      items.push({
        ...base,
        status: "conflict",
        to_namespace: "",
        to_id: "",
        reason: "quoted or commented id/namespace line",
      });
      continue;
    }
    const toNs = opts.mapping.files[rel] ?? opts.mapping.namespaces[fromNs];
    if (toNs === undefined) {
      items.push({
        ...base,
        status: "conflict",
        to_namespace: "",
        to_id: "",
        reason: `no mapping rule for namespace '${fromNs}'`,
      });
      continue;
    }
    items.push(
      toNs === fromNs
        ? { ...base, status: "unchanged", to_namespace: fromNs, to_id: fromId }
        : { ...base, status: "remap", to_namespace: toNs, to_id: rewriteId(fromId, toNs) },
    );
  }

  return { kbRoot: root, items };
}

export function writeInventory(plan: RemapPlan, file: string): void {
  const lines = plan.items.map((i) =>
    [i.path, i.status, i.from_namespace, i.to_namespace].join("\t"),
  );
  writeFileSync(file, `path\tstatus\tfrom\tto\n${lines.join("\n")}\n`, "utf8");
}
