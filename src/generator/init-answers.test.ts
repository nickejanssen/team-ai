import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadAnswerFile, parseAnswerList } from "./init-answers.js";

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "team-ai-answers-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

describe("parseAnswerList", () => {
  it("reads a YAML list of strings in order", () => {
    expect(parseAnswerList("- extend\n- instance\n- arcwright\n", "x.yaml")).toEqual([
      "extend",
      "instance",
      "arcwright",
    ]);
  });

  it("reads a JSON array (JSON is valid YAML)", () => {
    expect(parseAnswerList('["a", "b"]', "x.json")).toEqual(["a", "b"]);
  });

  it("coerces scalar entries to strings and keeps an explicit empty string", () => {
    expect(parseAnswerList('- "yes"\n- 4\n- ""\n', "x.yaml")).toEqual(["yes", "4", ""]);
  });

  it("rejects a non-list top level", () => {
    expect(() => parseAnswerList("key: value\n", "x.yaml")).toThrow(/top-level list/);
  });

  it("rejects a null entry", () => {
    expect(() => parseAnswerList("- a\n- null\n", "x.yaml")).toThrow(/entry 1 is null/);
  });
});

describe("loadAnswerFile", () => {
  it("yields entries in order", async () => {
    const pull = loadAnswerFile(tmpFile("a.yaml", "- one\n- two\n"));
    expect(await pull()).toBe("one");
    expect(await pull()).toBe("two");
  });

  it("rejects with 'answer file exhausted' when over-pulled", async () => {
    const pull = loadAnswerFile(tmpFile("a.yaml", "- only\n"));
    expect(await pull()).toBe("only");
    await expect(pull()).rejects.toThrow(/answer file exhausted/);
  });
});
