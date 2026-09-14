// Deterministic. No model calls. No network.
//
// Rewrites only the `id` and `namespace` scalar values inside the front-matter
// block. The value pattern stops before `\r`, so CRLF files keep their line
// endings. Refuses to touch any file while the plan contains a conflict.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RemapPlan } from "./plan.js";

const FRONT_MATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;

function setScalar(block: string, key: string, value: string): string {
  return block.replace(new RegExp(`^(${key}:[ \\t]*)[^\\r\\n]*`, "m"), `$1${value}`);
}

export function applyRemapPlan(plan: RemapPlan): { written: string[] } {
  const conflicts = plan.items.filter((i) => i.status === "conflict");
  if (conflicts.length > 0) {
    throw new Error(
      `refusing to apply: ${conflicts.length} conflict(s), first: ${conflicts[0]?.path} (${conflicts[0]?.reason ?? "conflict"})`,
    );
  }

  const written: string[] = [];
  for (const item of plan.items) {
    if (item.status !== "remap") continue;
    const abs = join(plan.kbRoot, item.path);
    const raw = readFileSync(abs, "utf8");
    const match = FRONT_MATTER.exec(raw);
    if (match === null) continue;
    const [whole, open, block, close] = match as unknown as [string, string, string, string];
    const next = setScalar(setScalar(block, "namespace", item.to_namespace), "id", item.to_id);
    if (next === block) continue;
    writeFileSync(abs, `${open}${next}${close}${raw.slice(whole.length)}`, "utf8");
    written.push(item.path);
  }
  return { written };
}
