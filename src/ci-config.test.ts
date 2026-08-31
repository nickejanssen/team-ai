import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("ci.yml", () => {
  const doc = parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
    jobs: Record<string, unknown>;
    permissions?: Record<string, string>;
  };
  it("has the three required jobs", () => {
    expect(Object.keys(doc.jobs).sort()).toEqual(
      ["lint-typecheck-test", "secret-scan", "validate"].sort(),
    );
  });
  it("is read-only by default", () => {
    expect(doc.permissions?.contents).toBe("read");
  });
});
