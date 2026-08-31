// Deterministic. No model calls.
//
// Orchestration for the golden eval harness: wires the knowledge base, the
// domain manifest, and the retrieval index together, replays each golden
// question through the architecture's routing procedure, and produces the
// per-question `EvalOutcome`s that `metrics.computeReport` aggregates.
//
// `routeQuestion` mirrors docs/architecture.md §16 exactly:
//   1. Zero-model exact keyword route when one domain uniquely owns the query.
//   2. Search-assisted route (tier "small") on a keyword tie or miss.
//   3. Refuse when retrieval returns nothing above the 0.2 score threshold.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { resolveCitation } from "../kb/citations.js";
import { loadKb } from "../kb/loader.js";
import type { KbDoc } from "../kb/types.js";
import { createAdapter } from "../retrieval/factory.js";
import type { Hit, RetrievalAdapter } from "../retrieval/types.js";
import type { GoldenQuestion, Manifest, ManifestDomain, ModelTier } from "../schema/types.js";
import { validate } from "../schema/validate.js";
import type { EvalOutcome, GateThresholds } from "./metrics.js";

const TOP_K = 8;
const REFUSE_ROUTE = "__refuse__";
const REFUSE_THRESHOLD = 0.2;

const DEFAULT_GATES: GateThresholds = {
  hitRate: 0.8,
  citationValidity: 1.0,
  routingAccuracy: 0.8,
  refusalRate: 1.0,
};

const TIER_RANK: Record<ModelTier, number> = { none: 0, small: 1, large: 2 };

export interface RoutingResult {
  route: string;
  tier: ModelTier;
}

export interface RunContext {
  instanceDir: string;
}

type SearchFn = (query: string) => Promise<Hit[]>;

function closeAdapter(adapter: RetrievalAdapter): void {
  const close = (adapter as { close?: () => void }).close;
  if (typeof close === "function") close.call(adapter);
}

function hitNamespace(hit: Hit): string | undefined {
  const namespace = hit.metadata.namespace;
  return typeof namespace === "string" ? namespace : undefined;
}

// How many of a domain's keywords occur as case-insensitive substrings of the
// question. Substring (not word) match is intentional: "429s" should match the
// keyword "429".
function keywordScore(question: string, keywords: string[]): number {
  const haystack = question.toLowerCase();
  return keywords.filter(
    (keyword) => keyword.length > 0 && haystack.includes(keyword.toLowerCase()),
  ).length;
}

export async function routeQuestion(
  question: string,
  manifest: Manifest,
  search: SearchFn,
): Promise<RoutingResult> {
  const domains = manifest.domains;

  // Step 1: zero-model exact route when exactly one domain owns the most keywords.
  const scored = domains.map((domain) => ({
    domain,
    score: keywordScore(question, domain.keywords),
  }));
  const maxScore = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
  if (maxScore > 0) {
    const leaders = scored.filter((entry) => entry.score === maxScore);
    const only = leaders.length === 1 ? leaders[0] : undefined;
    if (only !== undefined) {
      return { route: only.domain.subagent, tier: "none" };
    }
  }

  // Step 2: keyword tie or miss — let retrieval break the tie.
  const hits = await search(question);
  const top = hits[0];
  if (top !== undefined && top.score >= REFUSE_THRESHOLD) {
    const topNamespace = hitNamespace(top);
    if (topNamespace !== undefined) {
      const matches = domains.filter((domain) => domain.kb_namespace === topNamespace);
      const only = matches.length === 1 ? matches[0] : undefined;
      if (only !== undefined) {
        return { route: only.subagent, tier: "small" };
      }
    }
    // Namespace tie, or the top hit's namespace maps to no domain: walk the hits
    // in score order and route to the first whose namespace maps to a domain.
    const mapped = bestMappedDomain(hits, domains);
    if (mapped !== undefined) {
      return { route: mapped.subagent, tier: "small" };
    }
    const fallback = domains[0];
    if (fallback !== undefined) {
      return { route: fallback.subagent, tier: "small" };
    }
  }

  // Step 3: nothing retrievable above threshold.
  return { route: REFUSE_ROUTE, tier: "none" };
}

function bestMappedDomain(hits: Hit[], domains: ManifestDomain[]): ManifestDomain | undefined {
  for (const hit of hits) {
    const namespace = hitNamespace(hit);
    if (namespace === undefined) continue;
    const domain = domains.find((candidate) => candidate.kb_namespace === namespace);
    if (domain !== undefined) return domain;
  }
  return undefined;
}

function stripKbPrefix(path: string): string {
  return path.startsWith("kb/") ? path.slice(3) : path;
}

function expectedPathHit(expectPaths: string[], hits: Hit[]): boolean {
  if (expectPaths.length === 0) return false;
  const hitPaths = new Set(hits.map((hit) => hit.path));
  return expectPaths.some((path) => hitPaths.has(path) || hitPaths.has(stripKbPrefix(path)));
}

function readManifest(instanceDir: string): Manifest {
  const path = join(instanceDir, "manifest.yaml");
  const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
  const result = validate("manifest", parsed);
  if (!result.ok) {
    throw new Error(`invalid manifest.yaml: ${result.errors[0] ?? "validation failed"}`);
  }
  return result.value;
}

function citationsResolve(docs: KbDoc[], expectPaths: string[]): boolean {
  return expectPaths.every((path) => resolveCitation(docs, path).ok);
}

export async function runGoldenFile(
  questions: GoldenQuestion[],
  ctx: RunContext,
): Promise<EvalOutcome[]> {
  const docs = await loadKb(join(ctx.instanceDir, "kb"));
  const manifest = readManifest(ctx.instanceDir);

  const adapter = createAdapter(ctx.instanceDir);
  try {
    await adapter.reindex();
    const search: SearchFn = (query) => adapter.search(query, { k: TOP_K });

    const outcomes: EvalOutcome[] = [];
    for (const question of questions) {
      const hits = await search(question.question);
      const routing = await routeQuestion(question.question, manifest, search);
      const refuseExpected = question.expect_route === REFUSE_ROUTE;
      const routedTo = routing.route;

      outcomes.push({
        id: question.id,
        question: question.question,
        hit: expectedPathHit(question.expect_paths, hits),
        citationsValid: citationsResolve(docs, question.expect_paths),
        routedTo,
        routeCorrect: routedTo === question.expect_route,
        tier: routing.tier,
        tierOk: TIER_RANK[routing.tier] <= TIER_RANK[question.expect_tier_max],
        refuseExpected,
        refuseCorrect: refuseExpected ? routedTo === REFUSE_ROUTE : routedTo !== REFUSE_ROUTE,
      });
    }
    return outcomes;
  } finally {
    closeAdapter(adapter);
  }
}

export function loadGates(instanceDir: string): GateThresholds {
  const path = join(instanceDir, "evals", "gates.yaml");
  if (!existsSync(path)) return { ...DEFAULT_GATES };

  const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_GATES };

  const record = parsed as Record<string, unknown>;
  const pick = (key: keyof GateThresholds): number => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_GATES[key];
  };

  return {
    hitRate: pick("hitRate"),
    citationValidity: pick("citationValidity"),
    routingAccuracy: pick("routingAccuracy"),
    refusalRate: pick("refusalRate"),
  };
}
