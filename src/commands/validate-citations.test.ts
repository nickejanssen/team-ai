import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "./validate-citations.js";

const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

afterEach(() => {
  log.mockClear();
  error.mockClear();
});

describe("validate-citations", () => {
  it("passes when every citation resolves", async () => {
    const code = await run({ root: "src/commands/fixtures/cited-repo-ok" });
    expect(code).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^OK \d+ citation\(s\) across \d+ file\(s\)$/);
  });

  it("reports an unresolved citation", async () => {
    const code = await run({ root: "src/commands/fixtures/cited-repo" });
    expect(code).toBe(1);
    const printed = error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("platform/nope.md");
    expect(printed).toMatch(/kb\/platform\/y\.md: platform\/nope\.md — /);
  });

  it("fails when neither kb/ nor agents/ exists under the root", async () => {
    const code = await run({ root: "src/commands/fixtures/does-not-exist" });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "no kb/ or agents/ under src/commands/fixtures/does-not-exist",
    );
  });

  it("does not throw on front-matter-invalid KB docs, but returns 1 with a note", async () => {
    const code = await run({ root: "src/commands/fixtures/cited-repo-broken" });
    expect(code).toBe(1);
    const printed = error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed.toLowerCase()).toContain("front matter");
  });
});
