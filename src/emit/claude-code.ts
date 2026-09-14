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

export interface EmitClaudeCodeOptions {
  filePrefix?: string;
  pluginManifest?: boolean;
  builtinSearch?: boolean;
}

const BUILTIN_SEARCH_TOOLS = ["Read", "Grep", "Glob"];

// Agent names come from instance files a person can edit, so every path is
// resolved through `resolveWithin` rather than joined blindly.
function write(outDir: string, rel: string, content: string): string {
  const path = resolveWithin(outDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

function searchSection(namespaces: string[]): string {
  const lines = namespaces.map(
    (ns) =>
      `- \`${ns}\`: search the KB root for \`^namespace: ${ns}\` to list your documents, then read only those.`,
  );
  return [
    "",
    "## Finding your documents",
    "",
    "Your knowledge is the Markdown under the KB root declared in `team-ai/index.lock`. Each document has a `namespace:` front-matter line.",
    "",
    ...lines,
    "",
    "Cite each document by path. If nothing in your namespaces answers the question, say so and name the owner instead of answering from general knowledge.",
  ].join("\n");
}

function frontMatter(input: EmitInput["agents"][number], opts: EmitClaudeCodeOptions): string {
  const tools = opts.builtinSearch === true ? BUILTIN_SEARCH_TOOLS : input.def.tools;
  const meta = {
    name: input.def.name,
    description: input.def.description,
    tools: tools.join(", "),
    kind: input.def.kind,
    model_tier: input.def.model_tier,
    kb_namespaces: input.def.kb_namespaces,
    max_hops: input.def.max_hops,
  };
  const extra = opts.builtinSearch === true ? searchSection(input.def.kb_namespaces) : "";
  const body = `${input.instructions.trim()}${extra}`.trim();
  return `---\n${stringifyYaml(meta)}---\n\n${body}${body.length > 0 ? "\n" : ""}`;
}

export function emitClaudeCode(
  input: EmitInput,
  outDir: string,
  opts: EmitClaudeCodeOptions = {},
): string[] {
  const written: string[] = [];

  for (const agent of input.agents) {
    written.push(
      write(
        outDir,
        `.claude/agents/${opts.filePrefix ?? ""}${agent.name}.md`,
        frontMatter(agent, opts),
      ),
    );
  }

  if (opts.pluginManifest !== false) {
    const plugin = {
      name: "team-ai-emitted",
      description: "Agents and skills emitted from a team-ai instance.",
      version: packageVersion(),
      agents: input.agents.map((a) => `./.claude/agents/${opts.filePrefix ?? ""}${a.name}.md`),
      skills: input.skills.map((s) => s.name),
    };
    written.push(
      write(outDir, ".claude-plugin/plugin.json", `${JSON.stringify(plugin, null, 2)}\n`),
    );
  }

  return written;
}
