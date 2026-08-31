import { pathToFileURL } from "node:url";

import { Command } from "commander";

import * as validateCitations from "./commands/validate-citations.js";
import * as validateKb from "./commands/validate-kb.js";
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
