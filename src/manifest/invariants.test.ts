import { describe, expect, it } from "vitest";

import type { AgentDef, Manifest } from "../schema/types.js";
import { checkManifestInvariants } from "./invariants.js";

function def(name: string, over: Partial<AgentDef> = {}): AgentDef {
  return {
    name,
    kind: "subagent",
    description: name,
    model_tier: "small",
    kb_namespaces: [name.replace(/-sme$/, "")],
    tools: [],
    max_hops: 0,
    instructions_file: `agents/${name}.md`,
    ...over,
  };
}

const base: Manifest = {
  domains: [
    {
      id: "safety",
      description: "d",
      keywords: [],
      kb_namespace: "safety",
      subagent: "safety-sme",
      model_tier: "small",
      owner: "o",
      escalate_to: "engine-sme",
    },
  ],
  agents: [
    { name: "sme", tier: 1, kind: "router", max_hops: 2, kb_namespaces: [] },
    {
      name: "engine-sme",
      tier: 2,
      kind: "subagent",
      group: "engine",
      max_hops: 1,
      kb_namespaces: ["safety"],
    },
    {
      name: "safety-sme",
      tier: 3,
      kind: "subagent",
      group: "engine",
      max_hops: 0,
      kb_namespaces: ["safety"],
    },
  ],
};

const defs = new Map<string, AgentDef>([
  ["sme", def("sme", { kind: "router", model_tier: "none", max_hops: 2, kb_namespaces: [] })],
  ["engine-sme", def("engine-sme", { max_hops: 1, kb_namespaces: ["safety"] })],
  ["safety-sme", def("safety-sme")],
]);

const rules = (m: Manifest, d = defs): string[] => checkManifestInvariants(m, d).map((v) => v.rule);

describe("checkManifestInvariants", () => {
  it("passes a consistent topology", () => {
    expect(rules(base)).toEqual([]);
  });

  it("requires the router definition to make no model call", () => {
    const d = new Map(defs);
    d.set(
      "sme",
      def("sme", { kind: "router", model_tier: "small", max_hops: 2, kb_namespaces: [] }),
    );
    expect(rules(base, d)).toContain("router-model-tier");
  });

  it("requires tier-3 agents to be terminal with one namespace", () => {
    const m: Manifest = {
      ...base,
      agents: base.agents!.map((a) => (a.tier === 3 ? { ...a, max_hops: 1 } : a)),
    };
    expect(rules(m)).toContain("specialist-terminal");
  });

  it("rejects two specialists sharing a namespace", () => {
    const m: Manifest = {
      ...base,
      agents: [
        ...base.agents!,
        { name: "other-sme", tier: 3, kind: "subagent", max_hops: 0, kb_namespaces: ["safety"] },
      ],
    };
    const d = new Map(defs);
    d.set("other-sme", def("other-sme", { kb_namespaces: ["safety"] }));
    expect(rules(m, d)).toContain("specialist-namespace-unique");
  });

  it("rejects unresolved subagent and escalate_to references", () => {
    const m: Manifest = {
      ...base,
      domains: [{ ...base.domains[0]!, subagent: "missing-sme", escalate_to: "nobody" }],
    };
    expect(rules(m)).toEqual(expect.arrayContaining(["domain-subagent", "escalate-to"]));
  });

  it("rejects a manifest agent whose definition disagrees", () => {
    const d = new Map(defs);
    d.set("safety-sme", def("safety-sme", { kb_namespaces: ["other"] }));
    expect(rules(base, d)).toContain("definition-mismatch");
  });
});
