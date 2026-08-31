import { describe, expect, it } from "vitest";

import { resolveCatalog } from "./resolve.js";

const TOOLKIT = "src/catalog/fixtures/toolkit";
const ORG = "src/catalog/fixtures/org";
const INSTANCE = "src/catalog/fixtures/instance";
const INVALID = "src/catalog/fixtures/invalid";

describe("resolveCatalog — layering", () => {
  it("lets the instance layer replace a toolkit entry and records origin", () => {
    const catalog = resolveCatalog({ toolkitDir: TOOLKIT, instanceDir: INSTANCE });
    const architect = catalog.roles.get("architect");
    expect(architect?.origin).toBe("instance");
    expect(architect?.value.summary).toBe("Instance override of the architect role");
  });

  it("keeps a toolkit-only entry at origin toolkit", () => {
    const catalog = resolveCatalog({ toolkitDir: TOOLKIT, instanceDir: INSTANCE });
    expect(catalog.roles.get("build-engineer")?.origin).toBe("toolkit");
  });

  it("records origin org for an org-layer override", () => {
    const catalog = resolveCatalog({ toolkitDir: TOOLKIT, orgDir: ORG });
    const skill = catalog.skills.get("kb-answer");
    expect(skill?.origin).toBe("org");
    expect(skill?.value.summary).toBe("Org-layer override of kb-answer.");
  });

  it("resolves cleanly with no orgDir or instanceDir", () => {
    const catalog = resolveCatalog({ toolkitDir: TOOLKIT });
    expect(catalog.roles.get("architect")?.origin).toBe("toolkit");
    expect(catalog.namespaces.get("engineering")?.value.second_level).toContain("patterns");
    expect(catalog.personas.get("internal-technical")?.value.body).toContain("kind: persona");
  });

  it("skips a kind whose subdir is absent in a layer", () => {
    // org fixture has only skills/; roles/namespaces/personas come from toolkit.
    const catalog = resolveCatalog({ toolkitDir: TOOLKIT, orgDir: ORG });
    expect(catalog.roles.get("architect")?.origin).toBe("toolkit");
  });

  it("throws catalog: <file>: <reason> on a schema-invalid entry", () => {
    expect(() => resolveCatalog({ toolkitDir: TOOLKIT, instanceDir: INVALID })).toThrow(
      /^catalog: .*architect\.yaml: /,
    );
  });
});

describe("resolveCatalog — shipped toolkit presets", () => {
  const catalog = resolveCatalog({ toolkitDir: "catalog" });

  it("loads every shipped preset", () => {
    expect(catalog.namespaces.size).toBe(4);
    expect(catalog.roles.size).toBe(5);
    expect(catalog.skills.size).toBe(9);
    expect(catalog.personas.size).toBe(3);
  });

  it("marks every shipped entry as toolkit origin", () => {
    for (const item of catalog.roles.values()) expect(item.origin).toBe("toolkit");
    for (const item of catalog.skills.values()) expect(item.origin).toBe("toolkit");
  });
});
