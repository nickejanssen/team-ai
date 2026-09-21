import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { describe, expect, it, vi } from "vitest";

import { emitClaudeCode } from "./claude-code.js";
import { loadEmitInput } from "./index.js";
import type { EmitInput } from "./index.js";
import { run as runEmit } from "../commands/emit.js";
import type { ModelTier } from "../schema/types.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/instance", import.meta.url));

async function inputWith(agent: {
  name: string;
  kb_namespaces: string[];
  model_tier?: ModelTier;
}): Promise<EmitInput> {
  const input = await loadEmitInput(FIXTURE);
  const base = input.agents.find((candidate) => candidate.def.kind === "subagent")!;
  return {
    ...input,
    agents: [{ ...base, name: agent.name, def: { ...base.def, ...agent } }],
  };
}

const TEST_CORPUS_TOKENS = { operating: 1 };

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
      corpusTokens: TEST_CORPUS_TOKENS,
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
    expect(front.model).toBe("haiku");
    expect(front.tools).toBe("Read, Grep, Glob");
    const searchProcedure = raw.indexOf("## Search procedure");
    expect(searchProcedure).toBeGreaterThanOrEqual(0);
    expect(raw).not.toContain("Original instructions");
    expect(raw).toContain(
      "The knowledge base is the Markdown under the KB root in `team-ai/index.lock`.",
    );
    expect(raw).toContain("Use Read, Grep, and Glob");
    for (const ns of agent.def.kb_namespaces) {
      expect(raw).toContain(`search the KB root for \`^namespace: ${ns}\` to list your documents`);
    }
  });

  it("writes the router routing procedure before its original instructions", async () => {
    const input = await loadEmitInput(FIXTURE);
    const out = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-router-"));
    emitClaudeCode(input, out, {
      builtinSearch: true,
      pluginManifest: false,
      corpusTokens: TEST_CORPUS_TOKENS,
    });
    const router = input.agents.find((a) => a.def.kind === "router")!;
    const raw = readFileSync(join(out, ".claude/agents", `${router.name}.md`), "utf8");

    expect(raw).toContain("Read `team-ai/manifest.yaml`");
    expect(raw).toContain("excluding `not_owned`");
    expect(raw).toContain("at most one hop");
    expect(raw).not.toContain("Original instructions");
  });

  it("tells a small-corpus agent to read every document", async () => {
    const input = await inputWith({
      name: "knowledge-graph-sme",
      kb_namespaces: ["knowledge-graph"],
    });
    const outDir = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-small-"));
    const out = emitClaudeCode(input, outDir, {
      builtinSearch: true,
      corpusTokens: { "knowledge-graph": 1926 },
    });
    const body = readFileSync(out[0]!, "utf8");
    expect(body).toContain("Read every one of them");
    expect(body).not.toContain("cli.js search");
  });

  it("tells a large-corpus agent to use ranked search", async () => {
    const input = await inputWith({
      name: "engineering-practice-sme",
      kb_namespaces: ["engineering-practice"],
    });
    const outDir = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-large-"));
    const out = emitClaudeCode(input, outDir, {
      builtinSearch: true,
      corpusTokens: { "engineering-practice": 609458 },
    });
    const body = readFileSync(out[0]!, "utf8");
    expect(body).toContain("cli.js search");
    expect(body).toContain("--namespace engineering-practice");
  });

  it("uses a caller-supplied search command for large corpora", async () => {
    const input = await inputWith({
      name: "engineering-practice-sme",
      kb_namespaces: ["engineering-practice"],
    });
    const outDir = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-search-command-"));
    const out = emitClaudeCode(input, outDir, {
      builtinSearch: true,
      corpusTokens: { "engineering-practice": 609458 },
      searchCommand: "python scripts/team_ai_cli.py",
    });
    const body = readFileSync(out[0]!, "utf8");
    expect(body).toContain('python scripts/team_ai_cli.py search "<the question, in full>"');
    expect(body).not.toContain("node ../team-ai/dist/cli.js");
  });

  it("maps the model tier onto the host's model field", async () => {
    const input = await inputWith({
      name: "billing-sme",
      kb_namespaces: ["operating"],
      model_tier: "small",
    });
    const outDir = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-model-"));
    const out = emitClaudeCode(input, outDir, {
      builtinSearch: true,
      corpusTokens: TEST_CORPUS_TOKENS,
    });
    const body = readFileSync(out[0]!, "utf8");
    expect(body).toMatch(/^model: \S+$/m);
    expect(body).toContain("model_tier: small");
  });

  it("gives a large-tier agent a different model from a small-tier one", async () => {
    const small = await inputWith({
      name: "billing-small",
      kb_namespaces: ["operating"],
      model_tier: "small",
    });
    const large = await inputWith({
      name: "billing-large",
      kb_namespaces: ["operating"],
      model_tier: "large",
    });
    const smallDir = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-model-small-"));
    const largeDir = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-model-large-"));
    const options = { builtinSearch: true, corpusTokens: TEST_CORPUS_TOKENS };
    const smallBody = readFileSync(emitClaudeCode(small, smallDir, options)[0]!, "utf8");
    const largeBody = readFileSync(emitClaudeCode(large, largeDir, options)[0]!, "utf8");
    const pick = (body: string): string | undefined => /^model: (\S+)$/m.exec(body)?.[1];
    expect(pick(smallBody)).not.toBe(pick(largeBody));
  });

  it("omits the original instructions in builtin-search mode", async () => {
    const input = await inputWith({ name: "billing-sme", kb_namespaces: ["operating"] });
    const outDir = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-no-original-"));
    const out = emitClaudeCode(input, outDir, {
      builtinSearch: true,
      corpusTokens: TEST_CORPUS_TOKENS,
    });
    const body = readFileSync(out[0]!, "utf8");
    expect(body).not.toContain("Original instructions");
    expect(body).not.toContain("kb_search");
    expect(body).toContain("## Search procedure");
  });

  it("keeps the original instructions when not in builtin-search mode", async () => {
    const input = await inputWith({ name: "billing-sme", kb_namespaces: ["operating"] });
    const outDir = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-original-"));
    const out = emitClaudeCode(input, outDir, { builtinSearch: false });
    expect(readFileSync(out[0]!, "utf8")).toContain("kb_search");
  });

  it.each(["../", "nested/", "nested\\", "C:\\absolute\\", "/absolute/"])(
    "rejects a path-like file prefix: %s",
    async (filePrefix) => {
      const input = await loadEmitInput(FIXTURE);
      const out = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-invalid-prefix-"));

      expect(() => emitClaudeCode(input, out, { filePrefix })).toThrow(
        "filePrefix must be a filename-only prefix",
      );
    },
  );
});

describe("team-ai emit", () => {
  it("suppresses the tracked-output warning with --allow-tracked", async () => {
    const out = mkdtempSync(join(tmpdir(), "team-ai-emit-cc-tracked-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await runEmit({ target: "claude-code", dir: FIXTURE, out, allowTracked: true })).toBe(
        0,
      );
      expect(error).not.toHaveBeenCalledWith(expect.stringContaining("not gitignored"));
    } finally {
      error.mockRestore();
    }
  });
});
