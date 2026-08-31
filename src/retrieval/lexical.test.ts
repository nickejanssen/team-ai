import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { LexicalAdapter } from "./lexical.js";

const DB = ".tmp-test/lex.sqlite";
afterEach(() => rmSync(".tmp-test", { recursive: true, force: true }));

function adapter(): LexicalAdapter {
  return new LexicalAdapter({ kbRoot: "src/kb/fixtures/kb", dbPath: DB });
}

describe("LexicalAdapter", () => {
  it("indexes and ranks the rate-limits doc first for a 429 query", async () => {
    const a = adapter();
    const stats = await a.reindex();
    expect(stats.chunks).toBeGreaterThan(0);
    expect(stats.driver).toBe("lexical");
    const hits = await a.search("what to do about 429 rate limit errors", { k: 5 });
    a.close();
    expect(hits[0]?.path).toMatch(/rate/);
    expect(hits[0]?.score).toBeGreaterThan(0.5);
    expect(hits[0]?.score).toBeLessThanOrEqual(1);
    expect(hits.every((h) => h.score >= 0 && h.score <= 1)).toBe(true);
  });

  it("caps k at 20 and is idempotent", async () => {
    const a = adapter();
    const s1 = await a.reindex();
    const s2 = await a.reindex();
    expect(s2.chunks).toBe(s1.chunks);
    const hits = await a.search("auth token", { k: 999 });
    a.close();
    expect(hits.length).toBeLessThanOrEqual(20);
  });

  it("post-filters by namespace", async () => {
    const a = adapter();
    await a.reindex();
    const hits = await a.search("charter mission auth rate", { namespace: "operating", k: 10 });
    a.close();
    expect(hits.every((h) => h.metadata.namespace === "operating")).toBe(true);
  });

  it("returns [] for a query that sanitizes to empty", async () => {
    const a = adapter();
    await a.reindex();
    const hits = await a.search("!!! ??? ...");
    a.close();
    expect(hits).toEqual([]);
  });

  it("get() returns a document and a section slice", async () => {
    const a = adapter();
    await a.reindex();
    const doc = await a.get("platform/rate-limits.md");
    expect(doc.frontmatter.namespace).toBe("platform");
    a.close();
  });

  it("get() throws for unknown id", async () => {
    const a = adapter();
    await a.reindex();
    await expect(a.get("nope/missing.md")).rejects.toThrow(/no document/);
    a.close();
  });

  it("get() resolves by front matter id and slices a section", async () => {
    const a = adapter();
    await a.reindex();
    const doc = await a.get("kb.platform.auth", "rotation");
    a.close();
    expect(doc.path).toBe("platform/auth.md");
    expect(doc.body).toMatch(/^## Rotation/);
    expect(doc.body).toContain("Rotate service keys every 90 days.");
    expect(doc.body).not.toContain("## Token Types");
  });

  it("get() throws for an unknown section", async () => {
    const a = adapter();
    await a.reindex();
    await expect(a.get("platform/auth.md", "nope")).rejects.toThrow(
      /no section 'nope' in platform\/auth\.md/,
    );
    a.close();
  });

  it("post-filters by status and tags", async () => {
    const a = adapter();
    await a.reindex();
    const hits = await a.search("rate limit token charter", {
      k: 10,
      filters: { status: ["active"], tags: ["429"] },
    });
    a.close();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.path === "platform/rate-limits.md")).toBe(true);
  });
});
