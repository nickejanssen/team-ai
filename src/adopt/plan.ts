// Deterministic. No model calls. No network.
//
// buildAdoptionPlan measures an existing repo against the framework standard and
// writes a two-file plan: docs/adoption-plan.md (human-readable) and
// adoption-plan.yaml (schema-valid, machine-applied by `team-ai adopt --apply`).
// It writes nothing else and never edits the repo it is measuring.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import Handlebars from "handlebars";
import { stringify as stringifyYaml } from "yaml";

import { CORE_SKILLS } from "../interview/gates.js";
import { scanPreflight } from "../interview/preflight.js";
import { parseFrontmatter } from "../kb/frontmatter.js";
import { slug } from "../kb/slugify.js";
import { validate } from "../schema/validate.js";
import { packageVersion } from "../version.js";
import { TEMPLATES_INSTANCE } from "../generator/entity-files.js";
import { renderTree } from "../generator/render.js";
import { detectSyncedSource, inferFrontmatter } from "./infer.js";
import { getGitAuthors } from "./git-owner.js";
import { proposeNamespaceMap } from "./namespaces.js";
import type {
  AdoptionPlan,
  BackfillItem,
  NamespaceDecision,
  NamespaceMatch,
  RelabelItem,
} from "./types.js";
import { gapVsQualityBar } from "./gap.js";

const DEFAULT_PRESET_SHAPE = ["operating", "platform", "patterns", "playbooks", "decisions"];
const DOC_TEMPLATE = new URL("../../src/adopt/plan-doc.hbs", import.meta.url);

export interface BuildAdoptionPlanOptions {
  root: string;
  out: string;
  horizonDays: number;
  namespaceMap?: Record<string, string>;
  today?: Date;
}

function isDir(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).join("/");
}

function topLevelFolders(docsRoot: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(docsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function markdownUnder(docsRoot: string): string[] {
  const out: string[] = [];
  const stack: string[] = [""];
  while (stack.length > 0) {
    const relDir = stack.pop();
    if (relDir === undefined) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(docsRoot, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = relDir.length > 0 ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) stack.push(rel);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(toPosix(rel));
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function stubContext(root: string): Record<string, unknown> {
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? "team";
  return {
    team: { name, slug: slug(name).replace(/-/g, ""), mission: "", size: "4-8" },
    org_path: "your-org",
    namespaces: DEFAULT_PRESET_SHAPE,
    driver: "lexical",
    hosting: "no-server",
    server: false,
    roles: [],
    domains: [],
    personas: ["internal-technical"],
    skills: [...CORE_SKILLS],
    seed: false,
    reviewByDate: "2099-01-01",
    strictness: "refuse-log-gap",
    writeBack: "pr-only",
    sensitivity: "three-tiers",
    preset: "generic",
  };
}

async function detectCollisions(root: string): Promise<string[]> {
  const dry = await renderTree({
    templateDir: TEMPLATES_INSTANCE,
    destDir: root,
    context: stubContext(root),
    dryRun: true,
  });
  return [...dry.collisions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function renderDoc(plan: AdoptionPlan, assessment: string): string {
  const source = readFileSync(fileURLToPath(DOC_TEMPLATE), "utf8");
  const satisfied = plan.gap.filter((g) => g.satisfied).length;
  return Handlebars.create().compile(source, { noEscape: true })({
    ...plan,
    assessment,
    gapSatisfied: satisfied,
    gapTotal: plan.gap.length,
    backfillCount: plan.backfill.length,
    decisionCount: plan.namespace_map.decisions.length,
    collisionCount: plan.collisions.length,
  });
}

export function writeAdoptionPlan(plan: AdoptionPlan, out: string, assessment = "unknown"): void {
  const check = validate("adoption-plan", plan);
  if (!check.ok) {
    throw new Error(`adoption plan is not schema-valid: ${check.errors.join("; ")}`);
  }
  mkdirSync(join(out, "docs"), { recursive: true });
  writeFileSync(join(out, "adoption-plan.yaml"), stringifyYaml(plan), "utf8");
  writeFileSync(join(out, "docs", "adoption-plan.md"), renderDoc(plan, assessment), "utf8");
}

export async function buildAdoptionPlan(opts: BuildAdoptionPlanOptions): Promise<AdoptionPlan> {
  const { root, out, horizonDays } = opts;
  const today = opts.today ?? new Date();

  const report = await scanPreflight(root);

  const docsRoot = isDir(join(root, "docs"))
    ? join(root, "docs")
    : isDir(join(root, "kb"))
      ? join(root, "kb")
      : null;
  if (docsRoot === null) {
    throw new Error(`team-ai adopt: no docs/ or kb/ directory under ${root}`);
  }

  const folders = topLevelFolders(docsRoot);
  const proposal = proposeNamespaceMap(folders, DEFAULT_PRESET_SHAPE);

  const matchedByFolder = new Map<string, string>();
  for (const entry of proposal.matched) matchedByFolder.set(entry.folder, entry.namespace);
  const decisionFolders = new Set(proposal.unmatched.map((u) => u.folder));

  for (const [folder, namespace] of Object.entries(opts.namespaceMap ?? {})) {
    matchedByFolder.set(folder, namespace);
    decisionFolders.delete(folder);
  }

  const matched: NamespaceMatch[] = [...matchedByFolder.entries()]
    .map(([folder, namespace]) => ({ folder, namespace }))
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  const decisions: NamespaceDecision[] = proposal.unmatched
    .filter((u) => decisionFolders.has(u.folder))
    .map((u) => ({ folder: u.folder, candidates: u.candidates, chosen: null }));

  const namespaceForFolder = (folder: string): string => matchedByFolder.get(folder) ?? "unmapped";

  const backfill: BackfillItem[] = [];
  const relabels: RelabelItem[] = [];

  for (const relFromDocs of markdownUnder(docsRoot)) {
    const abs = join(docsRoot, relFromDocs);
    const relFromRoot = toPosix(relative(root, abs));
    const folder = relFromDocs.includes("/") ? (relFromDocs.split("/")[0] ?? "") : "";
    const namespace = namespaceForFolder(folder);
    const raw = readFileSync(abs, "utf8");
    const hasFrontmatter = raw.startsWith("---\n");

    if (!hasFrontmatter) {
      const fm = inferFrontmatter({
        relPath: relFromDocs,
        body: raw,
        namespace,
        gitAuthors: getGitAuthors(abs, root),
        horizonDays,
        today,
      });
      backfill.push({
        path: relFromRoot,
        namespace,
        frontmatter: fm,
        approved: false,
        conflict: null,
      });
      continue;
    }

    const { data, body } = parseFrontmatter(raw);
    const result = validate("frontmatter", data);
    if (!result.ok) {
      const fm = inferFrontmatter({
        relPath: relFromDocs,
        body,
        namespace,
        gitAuthors: getGitAuthors(abs, root),
        horizonDays,
        today,
      });
      backfill.push({
        path: relFromRoot,
        namespace,
        frontmatter: fm,
        approved: false,
        conflict: result.errors[0] ?? "invalid front matter",
      });
    }

    const currentSource = typeof data.source === "string" ? data.source : null;
    const detected = detectSyncedSource(body);
    if ((currentSource === null || currentSource.length === 0) && detected !== null) {
      relabels.push({
        path: relFromRoot,
        current_source: currentSource,
        proposed_source: detected,
        approved: false,
      });
    }
  }

  const plan: AdoptionPlan = {
    generated_by: `team-ai adopt ${packageVersion()}`,
    root,
    created: today.toISOString(),
    namespace_map: { matched, decisions },
    backfill,
    relabels,
    gap: gapVsQualityBar(root),
    collisions: await detectCollisions(root),
  };

  writeAdoptionPlan(plan, out, report.assessment);
  return plan;
}
