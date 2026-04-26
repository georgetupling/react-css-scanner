import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const selectorOnlyMatchesInUnknownContextsRule: RuleDefinition = {
  id: "selector-only-matches-in-unknown-contexts",
  run(context) {
    return runSelectorOnlyMatchesInUnknownContextsRule(context);
  },
};

function runSelectorOnlyMatchesInUnknownContextsRule(context: RuleContext): UnresolvedFinding[] {
  return context.analysis.entities.selectorQueries
    .filter((query) => query.sourceResult.source.kind === "css-source")
    .filter((query) => query.status === "unsupported")
    .filter((query) => query.outcome === "possible-match")
    .filter((query) => query.constraint?.kind !== "unsupported")
    .map((query) => ({
      id: `selector-only-matches-in-unknown-contexts:${query.id}`,
      ruleId: "selector-only-matches-in-unknown-contexts" as const,
      confidence: "low" as const,
      message: `Selector "${query.selectorText}" may match, but only through render or selector context the scanner could not fully resolve.`,
      subject: {
        kind: "selector-query" as const,
        id: query.id,
      },
      location: query.location,
      evidence: buildSelectorEvidence(context, query),
      traces:
        context.includeTraces === false
          ? []
          : buildSelectorOnlyMatchesInUnknownContextsTraces(query),
      data: {
        selectorText: query.selectorText,
        constraint: query.constraint,
        outcome: query.outcome,
        status: query.status,
        reasons: query.sourceResult.reasons,
      },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildSelectorEvidence(
  context: RuleContext,
  query: RuleContext["analysis"]["entities"]["selectorQueries"][number],
): UnresolvedFinding["evidence"] {
  const evidence: UnresolvedFinding["evidence"] = [];

  if (query.stylesheetId && context.analysis.indexes.stylesheetsById.has(query.stylesheetId)) {
    evidence.push({
      kind: "stylesheet",
      id: query.stylesheetId,
    });
  }

  return evidence;
}

function buildSelectorOnlyMatchesInUnknownContextsTraces(
  query: RuleContext["analysis"]["entities"]["selectorQueries"][number],
): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:selector-only-matches-in-unknown-contexts:${query.id}`,
      category: "rule-evaluation",
      summary: `selector "${query.selectorText}" could only be classified as a possible match because part of the selector context is unknown`,
      anchor: query.location,
      children: [
        ...query.traces,
        {
          traceId: `rule-evaluation:selector-only-matches-in-unknown-contexts:${query.id}:result`,
          category: "rule-evaluation",
          summary: "selector query outcome was possible-match with unsupported analysis status",
          anchor: query.location,
          children: [],
          metadata: {
            selectorText: query.selectorText,
            outcome: query.outcome,
            status: query.status,
            reasons: query.sourceResult.reasons,
          },
        },
      ],
      metadata: {
        ruleId: "selector-only-matches-in-unknown-contexts",
        selectorQueryId: query.id,
        selectorText: query.selectorText,
      },
    },
  ];
}
