import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { findCitationsInText, resolveCitation } from "../kb/citations.js";
import { KbValidationError, loadKb } from "../kb/loader.js";
import type { KbDoc } from "../kb/types.js";

export interface ValidateCitationsOptions {
  root?: string;
}

interface Unresolved {
  file: string;
  citation: string;
  reason: string;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.split(/[\\/]/).join("/"))
    .sort((a, b) => a.localeCompare(b));
}

export async function run(opts: ValidateCitationsOptions): Promise<number> {
  const root = opts.root ?? ".";
  const kbDir = join(root, "kb");
  const agentsDir = join(root, "agents");

  const hasKb = await isDir(kbDir);
  const hasAgents = await isDir(agentsDir);

  if (!hasKb && !hasAgents) {
    console.error(`no kb/ or agents/ under ${root}`);
    return 1;
  }

  let kbDocs: KbDoc[] = [];
  if (hasKb) {
    try {
      kbDocs = await loadKb(kbDir);
    } catch (err) {
      if (err instanceof KbValidationError) {
        console.error(
          `citations cannot be checked until KB front matter is valid ` +
            `(${err.failures.length} invalid document(s))`,
        );
        for (const failure of err.failures) {
          console.error(`  ${failure.file}: ${failure.error}`);
        }
        return 1;
      }
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  const scopes: { dir: string; prefix: string }[] = [];
  if (hasKb) scopes.push({ dir: kbDir, prefix: "kb" });
  if (hasAgents) scopes.push({ dir: agentsDir, prefix: "agents" });

  const unresolved: Unresolved[] = [];
  let citationCount = 0;
  let fileCount = 0;

  for (const scope of scopes) {
    for (const relPath of await listMarkdown(scope.dir)) {
      fileCount += 1;
      const label = `${scope.prefix}/${relPath}`;
      const text = await readFile(join(scope.dir, relPath), "utf8");
      for (const citation of findCitationsInText(text)) {
        citationCount += 1;
        const result = resolveCitation(kbDocs, citation);
        if (!result.ok) {
          unresolved.push({ file: label, citation, reason: result.reason });
        }
      }
    }
  }

  if (unresolved.length > 0) {
    for (const item of unresolved) {
      console.error(`${item.file}: ${item.citation} — ${item.reason}`);
    }
    return 1;
  }

  console.log(`OK ${citationCount} citation(s) across ${fileCount} file(s)`);
  return 0;
}
