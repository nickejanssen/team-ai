// All file IO for `team-ai remap-namespaces`. Proposal by default; --apply writes.

import { readFileSync, writeFileSync } from "node:fs";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { applyRemapPlan } from "../remap/apply.js";
import { buildRemapPlan, writeInventory, type RemapMapping } from "../remap/plan.js";

export interface RemapNamespacesOptions {
  instance?: string;
  mapping?: string;
  out?: string;
  inventory?: string;
  apply?: boolean;
}

export function run(opts: RemapNamespacesOptions): Promise<number> {
  if (opts.mapping === undefined) {
    console.error("remap-namespaces: --mapping is required");
    return Promise.resolve(1);
  }
  const mapping = parseYaml(readFileSync(opts.mapping, "utf8")) as RemapMapping;
  const plan = buildRemapPlan({
    instance: opts.instance ?? ".",
    mapping: { namespaces: mapping.namespaces ?? {}, files: mapping.files ?? {} },
  });

  const counts = { remap: 0, unchanged: 0, skipped: 0, conflict: 0 };
  for (const item of plan.items) counts[item.status] += 1;

  const out = opts.out ?? "remap-proposal.yaml";
  writeFileSync(out, stringifyYaml(plan), "utf8");
  if (opts.inventory !== undefined) writeInventory(plan, opts.inventory);
  console.log(`remap proposal: ${out}`);
  console.log(
    `  remap ${counts.remap}  unchanged ${counts.unchanged}  skipped ${counts.skipped}  conflict ${counts.conflict}`,
  );
  for (const item of plan.items.filter((i) => i.status === "conflict")) {
    console.error(`  conflict: ${item.path} — ${item.reason ?? ""}`);
  }

  if (opts.apply !== true) return Promise.resolve(counts.conflict > 0 ? 1 : 0);
  try {
    const { written } = applyRemapPlan(plan);
    console.log(`  applied to ${written.length} file(s)`);
    return Promise.resolve(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return Promise.resolve(1);
  }
}
