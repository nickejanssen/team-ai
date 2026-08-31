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
const FENCE = /^(```|~~~)/;

function toPosix(relPath: string): string {
  return relPath.split(/[\\/]/).join("/");
}

function byPath(a: string, b: string): number {
  return a.localeCompare(b);
}

// Extract ATX headings in document order, ignoring heading-looking lines inside
// fenced code blocks. The chunker reuses this behaviour.
function extractHeadings(body: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING.exec(line);
    if (match?.[2]) headings.push(match[2].trim());
  }
  return headings;
}

async function listMarkdown(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(`KB root not found: ${root}`);
    }
    throw err;
  }
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .map(toPosix)
    .sort(byPath);
}

export async function loadKb(root: string): Promise<KbDoc[]> {
  const markdown = await listMarkdown(root);

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

  return docs.sort((a, b) => byPath(a.path, b.path));
}
