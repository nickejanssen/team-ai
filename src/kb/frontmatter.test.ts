import { describe, expect, it } from "vitest";

import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

const CANONICAL = `---
id: kb.platform.rate-limits
namespace: platform
title: Rate Limits
owner: solutions-architect
status: active
review_by: "2027-06-30"
sensitivity: internal
source: authored
tags:
  - throttling
supersedes: []
---

## Defaults

Body text.
`;

describe("parseFrontmatter", () => {
  it("parses YAML front matter and trims leading body whitespace", () => {
    const { data, body } = parseFrontmatter(CANONICAL);
    expect(data.id).toBe("kb.platform.rate-limits");
    expect(data.tags).toEqual(["throttling"]);
    expect(body.startsWith("## Defaults")).toBe(true);
  });

  it("keeps date-like scalars as strings", () => {
    const { data } = parseFrontmatter(CANONICAL);
    expect(typeof data.review_by).toBe("string");
    expect(data.review_by).toBe("2027-06-30");
  });

  it("returns empty data for a doc with no front matter", () => {
    const { data, body } = parseFrontmatter("# Just a heading\n");
    expect(data).toEqual({});
    expect(body).toBe("# Just a heading\n");
  });
});

describe("serializeFrontmatter", () => {
  it("emits keys in schema order, then remaining keys in insertion order", () => {
    const out = serializeFrontmatter(
      {
        status: "active",
        id: "kb.a.b",
        extra: "z",
        title: "T",
        namespace: "a",
        another: "y",
      },
      "Body\n",
    );
    const keys = out
      .split("\n")
      .filter((l) => /^[a-z_]+:/.test(l))
      .map((l) => l.split(":")[0]);
    expect(keys).toEqual(["id", "namespace", "title", "status", "extra", "another"]);
  });

  it("emits the --- fences and a blank line before the body", () => {
    const out = serializeFrontmatter({ id: "kb.a.b" }, "Body\n");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("---\n\nBody\n");
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("round-trip", () => {
  it("parse -> serialize -> parse yields deep-equal data", () => {
    const first = parseFrontmatter(CANONICAL);
    const reserialized = serializeFrontmatter(first.data, first.body);
    const second = parseFrontmatter(reserialized);
    expect(second.data).toEqual(first.data);
  });
});
