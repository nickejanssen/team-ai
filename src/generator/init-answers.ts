// Deterministic. No model calls. No network. One disk read at construction time.
//
// `loadAnswerFile` backs `team-ai init --answers <file>`: it reads a YAML or
// JSON file that is an ordered list of answer strings and returns the
// programmatic puller `init` expects (`() => Promise<string>`). The puller
// yields the list entries in order; asking for one past the end throws
// "answer file exhausted", which means the file is short a line for a question
// the interview actually reached — a real signal, not something to paper over.

import { readFileSync } from "node:fs";

import { parse as parseYaml } from "yaml";

function coerceEntry(value: unknown, index: number): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(
    `answer file entry ${index} is ${value === null ? "null" : typeof value}; ` +
      "every entry must be a string (or a scalar that reads as one)",
  );
}

export function parseAnswerList(text: string, source: string): string[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new Error(
      `${source}: not valid YAML/JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${source}: expected a top-level list of answer strings, got ${typeof parsed}`);
  }
  return parsed.map((entry, i) => coerceEntry(entry, i));
}

export function loadAnswerFile(path: string): () => Promise<string> {
  const entries = parseAnswerList(readFileSync(path, "utf8"), path);
  let index = 0;
  return (): Promise<string> => {
    if (index >= entries.length) {
      return Promise.reject(
        new Error(
          `answer file exhausted: ${path} has ${entries.length} entries but the interview asked for more. ` +
            "The file is missing an answer for a question the interview reached.",
        ),
      );
    }
    const next = entries[index] ?? "";
    index += 1;
    return Promise.resolve(next);
  };
}
