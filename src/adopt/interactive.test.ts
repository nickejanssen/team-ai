import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAdoptionPlan } from "./plan.js";
import { runInteractive } from "./interactive.js";

const FIXTURE = "src/adopt/fixtures/legacy-repo";
const TODAY = new Date("2026-08-31T00:00:00Z");

const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
const dirs: string[] = [];

function scriptedPuller(answers: string[]): () => Promise<string> {
  let i = 0;
  return () => Promise.resolve(answers[i++] ?? "skip");
}

afterEach(() => {
  log.mockClear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("runInteractive", () => {
  it("folds approve / skip / edit and a namespace pick back into the plan yaml", async () => {
    const repo = mkdtempSync(join(tmpdir(), "team-ai-interactive-"));
    dirs.push(repo);
    cpSync(FIXTURE, repo, { recursive: true });
    const plan = await buildAdoptionPlan({ root: repo, out: repo, horizonDays: 180, today: TODAY });
    const planPath = join(repo, "adoption-plan.yaml");

    // 3 backfill items: approve, skip, edit(owner=Ada); then one pick per decision.
    const decisionCount = plan.namespace_map.decisions.length;
    const picks = plan.namespace_map.decisions.map((d) =>
      d.folder === "prd" ? "operating" : (d.candidates[0] ?? "custom"),
    );
    const puller = scriptedPuller(["approve", "skip", "edit", "Ada", ...picks]);

    await runInteractive(planPath, { answers: puller });

    const { parse } = await import("yaml");
    const written = parse(readFileSync(planPath, "utf8")) as typeof plan;

    expect(written.backfill[0]?.approved).toBe(true);
    expect(written.backfill[1]?.approved).toBe(false);
    expect(written.backfill[2]?.approved).toBe(true);
    expect(written.backfill[2]?.frontmatter.owner).toBe("Ada");

    expect(written.namespace_map.decisions).toHaveLength(decisionCount);
    const prd = written.namespace_map.decisions.find((d) => d.folder === "prd");
    expect(prd?.chosen).toBe("operating");
  });
});
