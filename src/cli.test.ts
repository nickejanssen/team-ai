import { describe, expect, it } from "vitest";

import { buildProgram, main } from "./cli.js";
import { packageVersion } from "./version.js";

describe("cli module", () => {
  it("exports main as a function", () => {
    expect(typeof main).toBe("function");
  });
});

describe("buildProgram", () => {
  it("registers every command", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toContain("validate-kb");
    expect(names).toContain("validate-citations");
  });

  it("reports the package version", () => {
    expect(buildProgram().version()).toBe(packageVersion());
  });

  it("gives every registered command a description", () => {
    for (const command of buildProgram().commands) {
      expect(command.description().length).toBeGreaterThan(0);
    }
  });
});
