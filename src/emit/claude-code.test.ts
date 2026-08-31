import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { emitClaudeCode } from "./claude-code.js";
import { loadEmitInput } from "./index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/instance", import.meta.url));

describe("emitClaudeCode", () => {
  it("writes one agent markdown per agent with parseable front matter", async () => {
    const input = await loadEmitInput(FIXTURE);
    const out = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-"));
    const written = emitClaudeCode(input, out);

    for (const agent of input.agents) {
      const path = join(out, ".claude/agents", `${agent.name}.md`);
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf8");
      const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
      expect(match).not.toBeNull();
      const front = parseYaml(match?.[1] ?? "") as { name: string };
      expect(front.name).toBe(agent.def.name);
    }

    expect(written.some((p) => p.endsWith("plugin.json"))).toBe(true);
  });

  it("writes a valid .claude-plugin/plugin.json naming the agents and skills", async () => {
    const input = await loadEmitInput(FIXTURE);
    const out = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-"));
    emitClaudeCode(input, out);

    const pluginPath = join(out, ".claude-plugin/plugin.json");
    expect(existsSync(pluginPath)).toBe(true);
    const plugin = JSON.parse(readFileSync(pluginPath, "utf8")) as {
      name: string;
      agents: string[];
      skills: string[];
    };
    expect(typeof plugin.name).toBe("string");
    expect(plugin.agents).toHaveLength(input.agents.length);
    expect(plugin.skills).toEqual(["kb-answer"]);
  });
});
