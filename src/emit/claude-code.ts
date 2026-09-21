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
import type { ModelTier } from "../schema/types.js";
import { packageVersion } from "../version.js";
import type { EmitAgent, EmitInput } from "./index.js";

export interface EmitClaudeCodeOptions {
  filePrefix?: string;
  pluginManifest?: boolean;
  builtinSearch?: boolean;
  corpusTokens?: Record<string, number>;
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

const READ_ALL_TOKEN_LIMIT = 25_000;

// Claude Code reads `model`; `model_tier` is team-ai's own vocabulary and is
// inert to the host. Mapping one onto the other is what makes a declared cost
// tier real. `none` means the work needs no model judgement at all, so it takes
// the cheapest tier rather than being omitted. An absent `model` inherits the
// session default, which is the expensive outcome this mapping avoids.
const MODEL_FOR_TIER: Record<ModelTier, string> = {
  none: "haiku",
  small: "haiku",
  large: "sonnet",
};

function searchSection(agent: EmitAgent, corpusTokens: Record<string, number> | undefined): string {
  const common = [
    "## Search procedure",
    "",
    "The knowledge base is the Markdown under the KB root in `team-ai/index.lock`.",
    "",
  ];
  if (agent.def.kind === "router") {
    return [
      ...common,
      "Use Read, Grep, and Glob to search it.",
      "- Read `team-ai/manifest.yaml`.",
      "- Match keywords and description, excluding `not_owned`.",
      "- If exactly one domain matches, hand off to its subagent.",
      "- If none match, search the KB root once. Hand off if the hits' namespace belongs to a domain; otherwise say you don't know and name the likely owner.",
      "- Make at most one hop.",
    ].join("\n");
  }

  const namespaces = agent.def.kb_namespaces;

  if (agent.def.max_hops > 0) {
    return [
      ...common,
      "You delegate. You do not search your group's corpus yourself.",
      "",
      "- Read `team-ai/manifest.yaml` and find which of your domains owns the question.",
      `- Your domains: ${namespaces.join(", ")}.`,
      "- Hand off to that domain's subagent and stop.",
      "- Only when a question genuinely spans two of your domains, delegate to",
      "  both and reconcile their cited answers. Never answer from memory.",
      "- If none of your domains owns it, say so and name the likely owner.",
    ].join("\n");
  }

  if (corpusTokens === undefined) {
    throw new Error("builtin-search emit requires corpus sizes; none were computed");
  }

  const total = namespaces.reduce((sum, namespace) => sum + (corpusTokens[namespace] ?? 0), 0);
  const listing = namespaces
    .map(
      (namespace) => `- search the KB root for \`^namespace: ${namespace}\` to list your documents`,
    )
    .join("\n");

  if (total <= READ_ALL_TOKEN_LIMIT) {
    return [
      ...common,
      "Use Read, Grep, and Glob.",
      "",
      listing,
      "",
      `Your whole corpus is about ${total.toLocaleString()} tokens. Read every one of them before answering — do not guess which is relevant, and do not answer from a grep match alone.`,
      "",
      "Answer only from those documents, citing paths. If they do not answer the question, say so and name the owner.",
    ].join("\n");
  }

  const namespaceFlags = namespaces.map((namespace) => `--namespace ${namespace}`).join(" ");
  return [
    ...common,
    `Your corpus is about ${total.toLocaleString()} tokens — far too large to read. Use ranked search:`,
    "",
    "```bash",
    `node ../team-ai/dist/cli.js search "<the question, in full>" --root team-ai ${namespaceFlags} --k 8`,
    "```",
    "",
    "Read the files behind the top hits, then answer only from them, citing paths.",
    "Grep is a fallback for an exact string you already know, not a way to find relevant material — it misses any wording the document does not use.",
    "",
    "If nothing scores above the threshold, say you do not know and name the owner.",
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
    model: MODEL_FOR_TIER[input.def.model_tier],
    kb_namespaces: input.def.kb_namespaces,
    max_hops: input.def.max_hops,
  };
  const body =
    opts.builtinSearch === true
      ? searchSection(input, opts.corpusTokens)
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
