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

describe("emitClaudeCode — committed layout options", () => {
  it("prefixes file names, skips the plugin manifest, and uses built-in search", async () => {
    const input = await loadEmitInput(FIXTURE);
    const out = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-opts-"));
    const written = emitClaudeCode(input, out, {
      filePrefix: "team-ai-",
      pluginManifest: false,
      builtinSearch: true,
    });
    expect(written.some((p) => p.endsWith("plugin.json"))).toBe(false);
    const agent = input.agents[0]!;
    const raw = readFileSync(join(out, ".claude/agents", `team-ai-${agent.name}.md`), "utf8");
    const front = parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(raw)?.[1] ?? "") as {
      name: string;
      tools: string;
      model?: string;
    };
    expect(front.name).toBe(agent.def.name);
    expect(front.model).toBeUndefined();
    expect(front.tools).toBe("Read, Grep, Glob");
    for (const ns of agent.def.kb_namespaces) expect(raw).toContain(`^namespace: ${ns}`);
  });
});
