import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkBinResolves,
  checkConnectorRegistered,
  checkDenylist,
  checkGatesMatchDefault,
  checkGoldenAnswers,
  checkIndexBuilt,
  checkManifestAssembled,
  checkMcpTokenMinted,
  checkQuestionsYaml,
  checkRepoStructure,
  checkSchemasCompile,
  checkSeedDocuments,
  checkTemplatesDir,
  runInstanceChecks,
  runSelfChecks,
} from "./checks.js";

const COMPLETE = "src/doctor/fixtures/complete-instance";
const INCOMPLETE = "src/doctor/fixtures/incomplete-instance";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "team-ai-doctor-"));
  dirs.push(dir);
  return dir;
}

describe("self checks", () => {
  it("all pass on the framework tree", () => {
    const results = runSelfChecks(process.cwd());
    const failed = results.filter((r) => !r.ok);
    expect(failed).toEqual([]);
  });

  it("schemas compile", () => {
    expect(checkSchemasCompile(process.cwd()).ok).toBe(true);
  });

  it("denylist is present and non-empty", () => {
    expect(checkDenylist(process.cwd()).ok).toBe(true);
  });

  it("bin.team-ai resolves", () => {
    expect(checkBinResolves(process.cwd()).ok).toBe(true);
  });

  it("gates.yaml matches DEFAULT_GATES", () => {
    expect(checkGatesMatchDefault(process.cwd()).ok).toBe(true);
  });

  it("flags a gates.yaml that diverges from DEFAULT_GATES", () => {
    const dir = tmp();
    mkdirSync(join(dir, "evals"));
    writeFileSync(join(dir, "evals", "gates.yaml"), "hitRate: 0.5\n", "utf8");
    const result = checkGatesMatchDefault(dir);
    expect(result.ok).toBe(false);
  });

  it("parses the shipped question bank and finds the templates tree", () => {
    const questions = checkQuestionsYaml(process.cwd());
    const templates = checkTemplatesDir(process.cwd());
    expect(questions.ok).toBe(true);
    expect(questions.skipped).toBeFalsy();
    expect(templates.ok).toBe(true);
    expect(templates.skipped).toBeFalsy();
    expect(templates.note).toMatch(/entr/);
  });
});

describe("instance checks — complete fixture", () => {
  it("passes structure, seed docs, manifest, and golden answers", async () => {
    expect(checkRepoStructure(COMPLETE).ok).toBe(true);

    const seed = await checkSeedDocuments(COMPLETE);
    expect(seed.ok).toBe(true);
    expect(seed.note).toMatch(/\d+ doc/);

    const manifest = checkManifestAssembled(COMPLETE);
    expect(manifest.ok).toBe(true);
    expect(manifest.note).toContain("domain");

    expect(checkGoldenAnswers(COMPLETE).ok).toBe(true);
  });

  it("still reports the manual and index items as failures", () => {
    expect(checkIndexBuilt(COMPLETE).ok).toBe(false);
    expect(checkMcpTokenMinted().ok).toBe(false);
    expect(checkConnectorRegistered().ok).toBe(false);
  });
});

describe("instance checks — incomplete fixture", () => {
  it("fails structure, manifest, index, and golden but passes front matter", async () => {
    expect(checkRepoStructure(INCOMPLETE).ok).toBe(false);
    expect((await checkSeedDocuments(INCOMPLETE)).ok).toBe(true);
    expect(checkManifestAssembled(INCOMPLETE).ok).toBe(false);
    expect(checkIndexBuilt(INCOMPLETE).ok).toBe(false);
    expect(checkGoldenAnswers(INCOMPLETE).ok).toBe(false);
  });

  it("runInstanceChecks returns seven results", async () => {
    const results = await runInstanceChecks(INCOMPLETE);
    expect(results).toHaveLength(7);
  });
});

describe("checkIndexBuilt", () => {
  it("passes once .team-ai/index.sqlite exists", () => {
    const dir = tmp();
    mkdirSync(join(dir, ".team-ai"));
    writeFileSync(join(dir, ".team-ai", "index.sqlite"), "", "utf8");
    expect(checkIndexBuilt(dir).ok).toBe(true);
  });
});
