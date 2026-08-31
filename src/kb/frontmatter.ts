import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface ParsedDoc {
  data: Record<string, unknown>;
  body: string;
}

// Parse and serialize both go through the `yaml` package so the two operations
// are symmetric. gray-matter's bundled js-yaml engine coerces bare `2027-01-01`
// scalars into `Date` objects, which would break front matter validation and
// round-tripping; the `yaml` core schema keeps them as strings.
const engines = {
  yaml: {
    parse: (input: string): object => {
      const parsed: unknown = parseYaml(input);
      return parsed !== null && typeof parsed === "object" ? parsed : {};
    },
    stringify: (input: object): string => stringifyYaml(input),
  },
};

// Front matter schema property order. Serialization emits known keys in this
// order, then any remaining keys in insertion order.
const KEY_ORDER = [
  "id",
  "namespace",
  "title",
  "owner",
  "status",
  "review_by",
  "sensitivity",
  "source",
  "source_url",
  "tags",
  "supersedes",
  "relations",
] as const;

export function parseFrontmatter(raw: string): ParsedDoc {
  const parsed = matter(raw, { engines });
  const data: Record<string, unknown> = { ...parsed.data };
  return {
    data,
    body: parsed.content.replace(/^\s+/, ""),
  };
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(data, key)) ordered[key] = data[key];
  }
  for (const key of Object.keys(data)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) ordered[key] = data[key];
  }
  return `---\n${stringifyYaml(ordered)}---\n\n${body.replace(/^\s+/, "")}\n`;
}
