import { pathToFileURL } from "node:url";

import { Command, Option } from "commander";

import * as assembleManifest from "./commands/assemble-manifest.js";
import * as checkAgnostic from "./commands/check-agnostic.js";
import * as doctor from "./commands/doctor.js";
import * as freshnessAudit from "./commands/freshness-audit.js";
import * as reindex from "./commands/reindex.js";
import * as runEvals from "./commands/run-evals.js";
import * as search from "./commands/search.js";
import * as validateCitations from "./commands/validate-citations.js";
import * as validateKb from "./commands/validate-kb.js";
import * as validateSpoke from "./commands/validate-spoke.js";
import { packageVersion } from "./version.js";

// Each command module owns its option parsing and exposes a single
// `run(opts): Promise<number>` that returns a process exit code. Adding a
// command later is: create `src/commands/<name>.ts` exporting `run`, then add
// one `registerCommand(...)` call below.
interface CommandRegistration<Options> {
  name: string;
  description: string;
  configure: (command: Command) => void;
  run: (opts: Options) => Promise<number>;
}

// Commander option collector for a repeatable, comma-splittable `--namespace`.
function collectNamespace(value: string, previous: string[]): string[] {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return previous.concat(parts);
}

function registerCommand<Options>(
  program: Command,
  registration: CommandRegistration<Options>,
): void {
  const command = program.command(registration.name).description(registration.description);
  registration.configure(command);
  command.action(async (opts: Options) => {
    process.exit(await registration.run(opts));
  });
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("team-ai")
    .description("Forkable framework for standing up a team's AI capability")
    .version(packageVersion());

  registerCommand(program, {
    name: "validate-kb",
    description: "Validate knowledge-base front matter and cross-document relations",
    configure: (command) => {
      command
        .option("--root <dir>", "knowledge-base root directory", "kb")
        .option("--schema-only", "validate front matter only; skip relation checks", false);
    },
    run: validateKb.run,
  });

  registerCommand(program, {
    name: "validate-citations",
    description: "Check that markdown citations resolve to knowledge-base documents",
    configure: (command) => {
      command.option("--root <dir>", "repository root containing kb/ and/or agents/", ".");
    },
    run: validateCitations.run,
  });

  registerCommand(program, {
    name: "validate-spoke",
    description: "Check a spoke repo against the spoke contract",
    configure: (command) => {
      command.option("--root <dir>", "spoke repo root directory", ".");
    },
    run: validateSpoke.run,
  });

  registerCommand(program, {
    name: "reindex",
    description: "Rebuild the retrieval index for an instance directory",
    configure: (command) => {
      command.option("--root <dir>", "instance root directory containing kb/", ".");
    },
    run: reindex.run,
  });

  registerCommand(program, {
    name: "assemble-manifest",
    description: "Merge the instance manifest fragment and spoke configs into manifest.yaml",
    configure: (command) => {
      command
        .option("--root <dir>", "instance root directory", ".")
        .option("--check", "verify manifest.yaml is current without writing it", false);
    },
    run: assembleManifest.run,
  });

  registerCommand(program, {
    name: "freshness-audit",
    description: "Report stale, orphaned, and unowned knowledge-base documents as JSON",
    configure: (command) => {
      command
        .option("--root <dir>", "knowledge-base root directory", "kb")
        .option("--fail-on-stale", "exit non-zero when stale documents exist", false)
        .option("--open-issues", "draft GitHub issues for stale docs (dry run only)", false)
        .option("--repo <owner/name>", "target repository for --open-issues live mode")
        .addOption(
          new Option("--today <YYYY-MM-DD>", "override today's date (testing)").hideHelp(),
        );
    },
    run: freshnessAudit.run,
  });

  registerCommand(program, {
    name: "run-evals",
    description: "Replay the golden eval set: hit rate, routing accuracy, refusal, tier ceiling",
    configure: (command) => {
      command
        .option("--root <dir>", "instance root directory", ".")
        .option("--golden <dir>", "golden set directory, relative to --root", "evals/golden")
        .option("--json", "emit the EvalReport as JSON instead of a table", false);
    },
    run: runEvals.run,
  });

  registerCommand(program, {
    name: "check-agnostic",
    description: "Fail if shipped framework source contains a team's proper nouns",
    configure: () => undefined,
    run: checkAgnostic.run,
  });

  registerCommand(program, {
    name: "doctor",
    description: "Run environment and setup checks (--self for framework CI, else an instance)",
    configure: (command) => {
      command
        .option("--root <dir>", "instance root directory to check", ".")
        .option("--self", "run framework self-verification instead of an instance check", false)
        .option("--strict", "treat not-built-yet and remaining items as failures", false);
    },
    run: doctor.run,
  });

  // `search` takes a positional argument, which the shared helper does not
  // model, so it is registered directly.
  program
    .command("search")
    .description("Query the retrieval index and print ranked hits")
    .argument("<query>", "search query text")
    .option("--root <dir>", "instance root directory containing kb/", ".")
    .option("--k <n>", "maximum number of hits", (value) => Number.parseInt(value, 10), 8)
    .option(
      "--namespace <ns>",
      "restrict to namespace(s); repeatable or comma-separated",
      collectNamespace,
      [],
    )
    .option("--json", "emit the raw Hit[] as JSON", false)
    .action(async (query: string, opts: search.SearchCommandOptions) => {
      process.exit(await search.run(query, opts));
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync(argv);
}

// Run when invoked directly (`node dist/cli.js …`). The installed binary calls
// `main()` from `bin/team-ai.js` instead.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
