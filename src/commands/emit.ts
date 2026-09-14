// Deterministic. No model calls. No network.
//
// `team-ai emit` translates a generated instance into a target platform's agent
// layout. It never writes outside `--out` (every emitter path is built under it)
// and warns when `--out` is not gitignored, since emitted output is a derived
// artifact that should not be committed.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { emitClaudeCode } from "../emit/claude-code.js";
import { emitGeneric } from "../emit/generic.js";
import { loadEmitInput } from "../emit/index.js";
import { emitMcpOnly } from "../emit/mcp-only.js";

export interface EmitCommandOptions {
  target?: string;
  dir?: string;
  out?: string;
  filePrefix?: string;
  pluginManifest?: boolean;
  builtinSearch?: boolean;
  allowTracked?: boolean;
}

const TARGETS = ["claude-code", "mcp-only", "generic"] as const;
type Target = (typeof TARGETS)[number];

function isGitIgnored(dir: string, outResolved: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", outResolved], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    // Not ignored, not a git repo, or git missing — fall back to a text scan.
  }
  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) return false;
  const base = basename(outResolved);
  const patterns = new Set([base, `${base}/`, `/${base}`, `/${base}/`]);
  return readFileSync(gitignore, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => patterns.has(line));
}

export async function run(opts: EmitCommandOptions): Promise<number> {
  const target = opts.target;
  if (target === undefined) {
    console.error(`emit: --target is required (one of: ${TARGETS.join(", ")})`);
    return 1;
  }
  if (!TARGETS.includes(target as Target)) {
    console.error(`emit: unknown target '${target}' (one of: ${TARGETS.join(", ")})`);
    return 1;
  }

  const dir = opts.dir ?? ".";
  const out = opts.out ?? "emitted";
  const outResolved = resolve(dir, out);

  if (opts.allowTracked !== true && !isGitIgnored(dir, outResolved)) {
    console.error(
      `WARNING: ${out} is not gitignored — emitted output is a derived artifact; ` +
        `add '${basename(outResolved)}/' to .gitignore. Continuing.`,
    );
  }

  const input = await loadEmitInput(dir);
  if (input.agents.length === 0) {
    console.error(`emit: no agents found under ${join(dir, "agents")}`);
    return 1;
  }

  let written: string[];
  if (target === "claude-code") {
    written = emitClaudeCode(input, outResolved, {
      ...(opts.filePrefix === undefined ? {} : { filePrefix: opts.filePrefix }),
      ...(opts.pluginManifest === undefined ? {} : { pluginManifest: opts.pluginManifest }),
      ...(opts.builtinSearch === undefined ? {} : { builtinSearch: opts.builtinSearch }),
    });
  } else if (target === "mcp-only") written = emitMcpOnly(input, outResolved);
  else written = emitGeneric(input, outResolved);

  for (const path of written) console.log(path);
  console.log(`emit: wrote ${written.length} file(s) for target '${target}' to ${outResolved}`);
  return 0;
}
