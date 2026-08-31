import { describe, expect, it } from "vitest";

import { KbValidationError, loadKb } from "./loader.js";

describe("loadKb", () => {
  it("loads the fixture corpus sorted by path", async () => {
    const docs = await loadKb("src/kb/fixtures/kb");
    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.path)).toEqual([...docs.map((d) => d.path)].sort());
    expect(docs.some((d) => d.frontmatter.namespace === "platform")).toBe(true);
    expect(docs.some((d) => d.frontmatter.namespace === "operating")).toBe(true);
    expect(docs.every((d) => d.isBacklog === false)).toBe(true);
  });

  it("uses POSIX separators and derives id from front matter", async () => {
    const docs = await loadKb("src/kb/fixtures/kb");
    expect(docs.every((d) => !d.path.includes("\\"))).toBe(true);
    const charter = docs.find((d) => d.path === "operating/charter.md");
    expect(charter?.id).toBe("kb.operating.charter");
  });

  it("reports every invalid doc at once", async () => {
    await expect(loadKb("src/kb/fixtures/kb-broken")).rejects.toThrow(KbValidationError);
    await expect(loadKb("src/kb/fixtures/kb-broken")).rejects.toThrow(/2 invalid document\(s\)/);
    const error = await loadKb("src/kb/fixtures/kb-broken").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KbValidationError);
    if (error instanceof KbValidationError) {
      expect(error.failures.map((f) => f.file).sort()).toEqual([
        "operating/missing-owner.md",
        "platform/bad-status.md",
      ]);
      expect(error.message).toContain("owner");
      expect(error.message).toContain("/status");
    }
  });

  it("flags _backlog docs", async () => {
    const docs = await loadKb("src/kb/fixtures/kb-backlog");
    expect(docs.some((d) => d.isBacklog)).toBe(true);
    expect(docs.filter((d) => d.isBacklog).every((d) => d.path.includes("_backlog/"))).toBe(true);
    expect(docs.filter((d) => !d.isBacklog).every((d) => !d.path.includes("_backlog/"))).toBe(true);
  });

  it("extracts headings in document order", async () => {
    const docs = await loadKb("src/kb/fixtures/kb");
    const rateLimits = docs.find((d) => d.path === "platform/rate-limits.md");
    expect(rateLimits?.headings).toEqual(["Defaults", "Handling 429s", "Backoff", "Escalation"]);
  });

  it("ignores non-markdown files", async () => {
    const docs = await loadKb("src/kb/fixtures/kb");
    expect(docs.every((d) => d.path.endsWith(".md"))).toBe(true);
  });
});
