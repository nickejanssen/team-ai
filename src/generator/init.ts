// Deterministic orchestration. No model calls. No network.
//
// `team-ai init` is the generator's keystone: it runs the preflight scan, walks
// the interview, builds the render context, then lays the instance down over the
// target directory WITHOUT ever overwriting human work. A dry render classifies
// every output path first; `planReconcile` decides whether the operator has to
// choose a coexistence strategy; only pristine prior renders are ever replaced.
//
// Ordering matters: templates render first, then per-entity agent files, then
// `writeOutputs` writes the profile + gate docs, then the generated-file
// manifest is merged, then reindex / assemble-manifest / doctor run as reports.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { select } from "@inquirer/prompts";

import type { RoleArchetype } from "../catalog/types.js";
import { generateStub } from "../catalog/stub.js";
import * as assembleManifest from "../commands/assemble-manifest.js";
import * as doctor from "../commands/doctor.js";
import * as reindex from "../commands/reindex.js";
import { loadBank } from "../interview/bank.js";
import { runInterviewCli } from "../interview/cli-runtime.js";
import { Engine } from "../interview/engine.js";
import { scanPreflight } from "../interview/preflight.js";
import { renderPreflight } from "../interview/preflight-report.js";
import { writeOutputs } from "../interview/outputs.js";
import { buildContext } from "./context.js";
import {
  mergeGeneratedManifest,
  readGeneratedManifest,
  sha256Of,
  type GeneratedEntry,
} from "./generated-manifest.js";
import {
  parseStrategy,
  planReconcile,
  RECONCILE_STRATEGIES,
  type ReconcilePlan,
} from "./reconcile.js";
import { renderTemplate, renderTree, type RenderResult } from "./render.js";

type Strategy = ReconcilePlan["strategy"];

export interface InitOptions {
  dir?: string;
  dryRun?: boolean;
  resume?: boolean;
  onConflict?: Strategy;
  answers?: () => Promise<string>;
  preflightTarget?: string;
  output?: (s: string) => void;
}

const TEMPLATES_INSTANCE = fileURLToPath(new URL("../../templates/instance", import.meta.url));
const TEMPLATES_MCP = fileURLToPath(new URL("../../templates/mcp-server", import.meta.url));

const STAND_DOWN_NOTE = [
  "",
  "Preflight assessment is STAND-DOWN: an org enterprise-search deployment already",
  'answers "where is the doc". team-ai will generate only the deterministic layer —',
  "agents, personas, skills, docs, and the manifest — and will skip the kb/ seed,",
  "the retrieval index, the MCP config, and the eval suite.",
  "",
].join("\n");

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asDomains(value: unknown): { slug: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { slug: string; name: string }[] = [];
  for (const item of value) {
    if (item !== null && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      if (typeof rec.slug === "string" && typeof rec.name === "string") {
        out.push({ slug: rec.slug, name: rec.name });
      }
    }
  }
  return out;
}

function asRoles(value: unknown): RoleArchetype[] {
  return Array.isArray(value) ? (value as RoleArchetype[]) : [];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function readTemplate(rel: string): string {
  return readFileSync(join(TEMPLATES_INSTANCE, rel), "utf8");
}

/**
 * Classify one generated file against what is on disk and the prior manifest,
 * then write it unless doing so would clobber human work. Mirrors `renderTree`'s
 * non-destructive semantics for the per-entity files it does not itself emit.
 */
function writeIfSafe(
  outRel: string,
  content: string,
  renderDir: string,
  priorByPath: Map<string, string>,
  onCollision: "siblings" | "skip",
  result: RenderResult,
): void {
  const outAbs = join(renderDir, outRel);

  if (!existsSync(outAbs)) {
    result.created.push(outRel);
    result.manifestEntries.push({ path: outRel, sha256: sha256Of(content) });
    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, content, "utf8");
    return;
  }

  const current = readFileSync(outAbs, "utf8");
  if (current === content) {
    result.unchanged.push(outRel);
    return;
  }

  const prior = priorByPath.get(outRel);
  if (prior !== undefined && prior === sha256Of(current)) {
    result.updated.push(outRel);
    result.manifestEntries.push({ path: outRel, sha256: sha256Of(content) });
    writeFileSync(outAbs, content, "utf8");
    return;
  }

  result.collisions.push(outRel);
  if (onCollision === "siblings") {
    const siblingRel = `${outRel}.team-ai-new`;
    result.siblingsWritten.push(siblingRel);
    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(`${outAbs}.team-ai-new`, content, "utf8");
  }
}

function renderEntityFiles(
  context: Record<string, unknown>,
  renderDir: string,
  priorByPath: Map<string, string>,
  onCollision: "siblings" | "skip",
  result: RenderResult,
): void {
  const namespaces = asStrings(context.namespaces);
  const firstNamespace = namespaces[0] ?? "operating";

  const domainYaml = readTemplate("agents/_domain-sme.yaml.hbs");
  const domainMd = readTemplate("agents/_domain-sme.md.hbs");
  for (const domain of asDomains(context.domains)) {
    const ctx = {
      ...context,
      slug: domain.slug,
      name: domain.name,
      namespace: firstNamespace,
      escalate_to: "unassigned",
    };
    const yaml = renderTemplate(domainYaml, ctx, `agents/${domain.slug}-sme.yaml`);
    const md = renderTemplate(domainMd, ctx, `agents/${domain.slug}-sme.md`);
    result.warnings.push(...yaml.warnings, ...md.warnings);
    writeIfSafe(
      `agents/${domain.slug}-sme.yaml`,
      yaml.output,
      renderDir,
      priorByPath,
      onCollision,
      result,
    );
    writeIfSafe(
      `agents/${domain.slug}-sme.md`,
      md.output,
      renderDir,
      priorByPath,
      onCollision,
      result,
    );
  }

  const roleYaml = readTemplate("agents/roles/_role.yaml.hbs");
  const roleMd = readTemplate("agents/roles/_role.md.hbs");
  for (const role of asRoles(context.roles)) {
    const ctx = { ...context, ...role };
    const yaml = renderTemplate(roleYaml, ctx, `agents/roles/${role.name}.yaml`);
    const md = renderTemplate(roleMd, ctx, `agents/roles/${role.name}.md`);
    result.warnings.push(...yaml.warnings, ...md.warnings);
    writeIfSafe(
      `agents/roles/${role.name}.yaml`,
      yaml.output,
      renderDir,
      priorByPath,
      onCollision,
      result,
    );
    writeIfSafe(
      `agents/roles/${role.name}.md`,
      md.output,
      renderDir,
      priorByPath,
      onCollision,
      result,
    );
  }

  for (const persona of asStrings(context.personas)) {
    const templateRel = `personas/${persona}.md.hbs`;
    let content: string;
    if (existsSync(join(TEMPLATES_INSTANCE, templateRel))) {
      const rendered = renderTemplate(readTemplate(templateRel), context, `personas/${persona}.md`);
      result.warnings.push(...rendered.warnings);
      content = rendered.output;
    } else {
      content = generateStub(persona, "persona");
    }
    writeIfSafe(`personas/${persona}.md`, content, renderDir, priorByPath, onCollision, result);
  }
}

function computeExclude(seed: boolean, standDown: boolean): string[] {
  // `renderTree` matches these against the template-relative path (the `.hbs` is
  // still attached); a trailing `/` matches a subtree, otherwise it is exact.
  const exclude = ["mcp-server/"];
  if (!seed || standDown) exclude.push("kb/");
  if (standDown) exclude.push("index.lock.hbs", ".mcp.json.hbs", "evals/");
  return exclude;
}

function summary(result: RenderResult, output: (s: string) => void): void {
  output("");
  output(
    `${result.created.length} file(s) created, ${result.unchanged.length} unchanged, ` +
      `${result.updated.length} updated, ${result.collisions.length} collision(s).`,
  );
  if (result.siblingsWritten.length > 0) {
    output(
      `Wrote ${result.siblingsWritten.length} sibling file(s) — review each *.team-ai-new ` +
        "against the file it sits beside, then delete or merge it.",
    );
  }
  for (const collision of result.collisions) {
    if (!result.siblingsWritten.some((s) => s === `${collision}.team-ai-new`)) {
      output(`  kept your version, skipped: ${collision}`);
    }
  }
}

async function chooseStrategy(
  promptText: string,
  answers: (() => Promise<string>) | undefined,
  output: (s: string) => void,
): Promise<Strategy> {
  output(promptText);
  if (answers) {
    return parseStrategy(await answers()) ?? "adopt-existing";
  }
  const picked = await select<Strategy>({
    message: "How should team-ai lay itself down here?",
    choices: RECONCILE_STRATEGIES.map((value) => ({ value, name: value })),
  });
  return picked;
}

export async function run(opts: InitOptions): Promise<number> {
  const output = opts.output ?? ((s: string): void => console.log(s));
  const dir = opts.dir ?? ".";

  const report = await scanPreflight(opts.preflightTarget ?? dir);
  output(renderPreflight(report));

  const standDown = report.assessment === "stand-down";
  if (standDown) output(STAND_DOWN_NOTE);

  const interviewOpts: Parameters<typeof runInterviewCli>[0] = { cwd: dir };
  if (opts.answers !== undefined) interviewOpts.answers = opts.answers;
  if (opts.output !== undefined) interviewOpts.output = opts.output;
  const state = await runInterviewCli(interviewOpts);
  if (state.phase !== "done") {
    output("Interview not complete. Resume where you left off with:  team-ai init --resume");
    return 0;
  }

  const engine = Engine.load(loadBank(), state);
  const context = buildContext(engine);
  const seed = context.seed === true;
  const hosting = str(context.hosting, "no-server");
  const exclude = computeExclude(seed, standDown);

  const dry = await renderTree({
    templateDir: TEMPLATES_INSTANCE,
    destDir: dir,
    context,
    priorManifest: readGeneratedManifest(dir),
    dryRun: true,
    exclude,
  });

  const rc = planReconcile(dry, report, opts.onConflict);
  const strategy: Strategy =
    rc.needsPrompt && opts.onConflict === undefined
      ? await chooseStrategy(rc.promptText, opts.answers, output)
      : (rc.plan?.strategy ?? opts.onConflict ?? "adopt-existing");

  if (opts.dryRun === true) {
    output("");
    output(
      `Dry run: ${dry.created.length} would be created, ${dry.unchanged.length} unchanged, ` +
        `${dry.updated.length} updated, ${dry.collisions.length} collision(s).`,
    );
    output(`Strategy: ${strategy}. Nothing was written.`);
    return 0;
  }

  if (strategy === "abort") {
    await writeOutputs(engine, dir, { preflight: report });
    output("");
    output("Wrote the interview profile and gate docs only. No templates were generated.");
    return 0;
  }

  const renderDir = strategy === "subdir" ? join(dir, "team-ai") : dir;
  const onCollision: "siblings" | "skip" = strategy === "siblings" ? "siblings" : "skip";
  const priorManifest = readGeneratedManifest(renderDir);
  const priorByPath = new Map<string, string>(priorManifest.map((e) => [e.path, e.sha256]));

  const result = await renderTree({
    templateDir: TEMPLATES_INSTANCE,
    destDir: renderDir,
    context,
    priorManifest,
    onCollision,
    exclude,
  });

  renderEntityFiles(context, renderDir, priorByPath, onCollision, result);

  await writeOutputs(engine, renderDir, { preflight: report });

  const entityEntries: GeneratedEntry[] = result.manifestEntries;
  mergeGeneratedManifest(renderDir, entityEntries);

  if (
    strategy === "adopt-existing" &&
    (report.existingAssets.agentConfigFile !== undefined ||
      report.existingAssets.routerAgent !== undefined)
  ) {
    const adopted = [report.existingAssets.agentConfigFile, report.existingAssets.routerAgent]
      .filter((v): v is string => v !== undefined)
      .join(", ");
    appendFileSync(
      join(renderDir, "docs/architecture.md"),
      `\n\n## Coexistence boundary\n\nteam-ai runs in extend mode. Adopted (kept as-is): ${adopted}. ` +
        "team-ai added only the deterministic layer (schemas, scripts, index, gap log). " +
        "The existing router remains authoritative.\n",
      "utf8",
    );
  }

  if (hosting === "local-stdio" && !standDown) {
    const mcp = await renderTree({
      templateDir: TEMPLATES_MCP,
      destDir: join(renderDir, "mcp-server"),
      context,
      onCollision: "skip",
    });
    result.created.push(...mcp.created);
    result.unchanged.push(...mcp.unchanged);
    result.collisions.push(...mcp.collisions);
  }

  if (!standDown) {
    await reindex.run({ root: renderDir });
    await assembleManifest.run({ root: renderDir });
    await doctor.run({ root: renderDir });
  }

  summary(result, output);
  return 0;
}
