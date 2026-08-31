import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { validate } from "../schema/validate.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { KbDoc } from "./types.js";

export class KbValidationError extends Error {
  constructor(public readonly failures: { file: string; error: string }[]) {
    super(
      `${failures.length} invalid document(s):\n` +
        failures.map((f) => `  ${f.file}: ${f.error}`).join("\n"),
    );
    this.name = "KbValidationError";
  }
}

const HEADING = /^(#{1,6})\s+(.+)$/;

function toPosix(relPath: string): string {
  return relPath.split(/[\\/]/).join("/");
}

function extractHeadings(body: string): string[] {
  return body.split("\n").flatMap((line) => {
    const match = HEADING.exec(line);
    return match?.[2] ? [match[2].trim()] : [];
  });
}

export async function loadKb(root: string): Promise<KbDoc[]> {
  const entries = await readdir(root, { recursive: true });
  const markdown = entries
    .filter((entry) => entry.endsWith(".md"))
    .map(toPosix)
    .sort();

  const docs: KbDoc[] = [];
  const failures: { file: string; error: string }[] = [];

  for (const relPath of markdown) {
    const raw = await readFile(join(root, relPath), "utf8");
    const { data, body } = parseFrontmatter(raw);
    const result = validate("frontmatter", data);
    if (!result.ok) {
      failures.push({ file: relPath, error: result.errors[0] ?? "invalid front matter" });
      continue;
    }
    docs.push({
      id: result.value.id,
      path: relPath,
      frontmatter: result.value,
      body,
      headings: extractHeadings(body),
      isBacklog: relPath.split("/").includes("_backlog"),
    });
  }

  if (failures.length > 0) throw new KbValidationError(failures);

  return docs.sort((a, b) => a.path.localeCompare(b.path));
}
