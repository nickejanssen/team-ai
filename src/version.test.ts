import { describe, expect, it } from "vitest";
import { packageVersion } from "./version.js";

describe("packageVersion", () => {
  it("returns a semver string starting at 0.1.0", () => {
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
