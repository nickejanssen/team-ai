import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAdapter, VALID_DRIVERS } from "./factory.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("createAdapter", () => {
  it("returns a working lexical adapter when index.lock says lexical (or is absent)", async () => {
    dir = mkdtempSync(join(tmpdir(), "tai-"));
    const a = createAdapter(dir, { kbRoot: "src/kb/fixtures/kb" });
    const stats = await a.reindex();
    expect(stats.driver).toBe("lexical");
    if ("close" in a && typeof a.close === "function") (a as { close: () => void }).close();
  });

  it("returns the matching stub for a vector/graph driver", async () => {
    dir = mkdtempSync(join(tmpdir(), "tai-"));
    writeFileSync(
      join(dir, "index.lock"),
      "driver: graph\nchunk:\n  split_on: [h2, h3]\n  target_tokens: 800\n  hard_cap: 1200\nembedding: null\n",
    );
    const a = createAdapter(dir);
    await expect(a.search("q")).rejects.toThrow(/graph/);
  });

  it("throws with the valid-driver list on an unknown driver", () => {
    dir = mkdtempSync(join(tmpdir(), "tai-"));
    writeFileSync(
      join(dir, "index.lock"),
      "driver: sqlite-fts9\nchunk:\n  split_on: [h2]\n  target_tokens: 800\n  hard_cap: 1200\nembedding: null\n",
    );
    expect(() => createAdapter(dir)).toThrow(/unknown retrieval driver 'sqlite-fts9'/);
    expect(() => createAdapter(dir)).toThrow(/lexical.*graph|graph.*lexical/s);
  });

  it("VALID_DRIVERS has all six", () => {
    expect([...VALID_DRIVERS].sort()).toEqual(
      ["graph", "hybrid", "lexical", "vector-embedded", "vector-hosted", "vector-pgvector"].sort(),
    );
  });
});
