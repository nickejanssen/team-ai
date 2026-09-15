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
import type { EmitAgent, EmitInput } from "./index.js";

export interface EmitClaudeCodeOptions {
  filePrefix?: string;
  pluginManifest?: boolean;
  builtinSearch?: boolean;
}

const BUILTIN_SEARCH_TOOLS = ["Read", "Grep", "Glob"];
const INVALID_FILE_PREFIX = /[<>:"/\\|?*]/;

function validateFilePrefix(filePrefix: string | undefined): void {
  if (filePrefix === undefined || filePrefix.length === 0) return;
  if (
    filePrefix.includes("..") ||
    filePrefix === "." ||
    INVALID_FILE_PREFIX.test(filePrefix) ||
    [...filePrefix].some((char) => char.charCodeAt(0) < 0x20)
  ) {
    throw new Error("filePrefix must be a filename-only prefix");
  }
}

// Agent names come from instance files a person can edit, so every path is
// resolved through `resolveWithin` rather than joined blindly.
function write(outDir: string, rel: string, content: string): string {
  const path = resolveWithin(outDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

function searchSection(agent: EmitAgent): string {
  const common = [
    "## Search procedure",
    "",
    "The knowledge base is the Markdown under the KB root in `team-ai/index.lock`.",
    "Use Read, Grep, and Glob to search it. The tool names under Original instructions are unavailable.",
    "",
  ];
  if (agent.def.kind === "router") {
    return [
      ...common,
      "- Read `team-ai/manifest.yaml`.",
      "- Match keywords and description, excluding `not_owned`.",
      "- If exactly one domain matches, hand off to its subagent.",
      "- If none match, search the KB root once. Hand off if the hits' namespace belongs to a domain; otherwise say you don't know and name the likely owner.",
      "- Make at most one hop.",
    ].join("\n");
  }

  const lines = agent.def.kb_namespaces.map(
    (ns) => `- search the KB root for \`^namespace: ${ns}\` to list your documents`,
  );
  return [
    ...common,
    ...lines,
    "",
    "Search only those documents. Answer only from them, citing paths. If nothing answers, say so and name the owner.",
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
  const body =
    opts.builtinSearch === true
      ? `${searchSection(input)}\n\n## Original instructions\n\n${input.instructions.trim()}`.trim()
      : input.instructions.trim();
  return `---\n${stringifyYaml(meta)}---\n\n${body}${body.length > 0 ? "\n" : ""}`;
}

export function emitClaudeCode(
  input: EmitInput,
  outDir: string,
  opts: EmitClaudeCodeOptions = {},
): string[] {
  validateFilePrefix(opts.filePrefix);
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
