import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validate } from "../schema/validate.js";
import { buildAdoptionPlan } from "./plan.js";

const FIXTURE = "src/adopt/fixtures/legacy-repo";
const FIXTURE_FILES = ["README.md", "docs/architecture/a.md", "docs/notes/b.md", "docs/prd/c.md"];
const TODAY = new Date("2026-08-31T00:00:00Z");

const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "team-ai-plan-"));
  dirs.push(dir);
  return dir;
}

function fingerprint(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of FIXTURE_FILES) {
    out[rel] = createHash("sha256")
      .update(readFileSync(join(FIXTURE, rel)))
      .digest("hex");
  }
  return out;
}

afterEach(() => {
  log.mockClear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildAdoptionPlan", () => {
  it("writes exactly the plan doc and yaml, and nothing else, leaving the repo untouched", async () => {
    const before = fingerprint();
    const out = tmp();

    const plan = await buildAdoptionPlan({ root: FIXTURE, out, horizonDays: 180, today: TODAY });

    expect(readdirSync(out).sort()).toEqual(["adoption-plan.yaml", "docs"]);
    expect(readdirSync(join(out, "docs"))).toEqual(["adoption-plan.md"]);

    expect(fingerprint()).toEqual(before);

    const yaml = readFileSync(join(out, "adoption-plan.yaml"), "utf8");
    const { parse } = await import("yaml");
    expect(validate("adoption-plan", parse(yaml)).ok).toBe(true);

    expect(plan.backfill).toHaveLength(3);
    const notes = plan.backfill.find((b) => b.path === "docs/notes/b.md");
    expect(notes?.frontmatter.source).toBe("synced:notion");

    const decisionFolders = plan.namespace_map.decisions.map((d) => d.folder);
    expect(decisionFolders).toContain("prd");
    expect(decisionFolders).toContain("notes");

    expect(plan.gap).toHaveLength(17);
    expect(plan.created).toBe("2026-08-31T00:00:00.000Z");
  });

  it("applies a namespace-map override to move a folder into matched", async () => {
    const out = tmp();
    const plan = await buildAdoptionPlan({
      root: FIXTURE,
      out,
      horizonDays: 180,
      today: TODAY,
      namespaceMap: { prd: "operating" },
    });

    expect(plan.namespace_map.matched).toContainEqual({ folder: "prd", namespace: "operating" });
    expect(plan.namespace_map.decisions.map((d) => d.folder)).not.toContain("prd");
    const prdDoc = plan.backfill.find((b) => b.path === "docs/prd/c.md");
    expect(prdDoc?.namespace).toBe("operating");
  });
});
