// Deterministic. No model calls. No network.
//
// Emit a generated instance as a Claude Code plugin layout: one agent markdown
// file per agent (YAML front matter from the `AgentDef`, the instruction body
// underneath) plus a minimal `.claude-plugin/plugin.json` that names the agents
// and skills the plugin ships.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { stringify as stringifyYaml } from "yaml";

import { resolveWithin } from "../generator/contain.js";
import { packageVersion } from "../version.js";
import type { EmitInput } from "./index.js";

// Agent names come from instance files a person can edit, so every path is
// resolved through `resolveWithin` rather than joined blindly.
function write(outDir: string, rel: string, content: string): string {
  const path = resolveWithin(outDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

function frontMatter(input: EmitInput["agents"][number]): string {
  const meta = {
    name: input.def.name,
    description: input.def.description,
    kind: input.def.kind,
    model_tier: input.def.model_tier,
    kb_namespaces: input.def.kb_namespaces,
    tools: input.def.tools,
    max_hops: input.def.max_hops,
  };
  const body = input.instructions.trim();
  return `---\n${stringifyYaml(meta)}---\n\n${body}${body.length > 0 ? "\n" : ""}`;
}

export function emitClaudeCode(input: EmitInput, outDir: string): string[] {
  const written: string[] = [];

  for (const agent of input.agents) {
    written.push(write(outDir, `.claude/agents/${agent.name}.md`, frontMatter(agent)));
  }

  const plugin = {
    name: "team-ai-emitted",
    description: "Agents and skills emitted from a team-ai instance.",
    version: packageVersion(),
    agents: input.agents.map((a) => `./.claude/agents/${a.name}.md`),
    skills: input.skills.map((s) => s.name),
  };
  written.push(write(outDir, ".claude-plugin/plugin.json", `${JSON.stringify(plugin, null, 2)}\n`));

  return written;
}
