import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const compoundSelectorNeverMatchedRule: RuleDefinition = {
  id: "compound-selector-never-matched",
  run(context) {
    return runCompoundSelectorNeverMatchedRule(context);
  },
};

function runCompoundSelectorNeverMatchedRule(context: RuleContext): UnresolvedFinding[] {
  return context.analysis.entities.selectorQueries
    .filter((query) => query.sourceResult.source.kind === "css-source")
    .filter((query) => query.status === "resolved")
    .filter((query) => query.outcome === "no-match-under-bounded-analysis")
    .filter(
      (query) =>
        query.sourceResult.source.kind !== "css-source" ||
        (query.sourceResult.source.branchCount ?? 1) === 1,
    )
    .filter(
      (query) =>
        query.constraint?.kind === "same-node-class-conjunction" &&
        query.constraint.classNames.length > 1,
    )
    .map((query) => ({
      id: `compound-selector-never-matched:${query.id}`,
      ruleId: "compound-selector-never-matched" as const,
      confidence: query.confidence,
      message: `Compound selector "${query.selectorText}" requires classes that are never emitted together on one known reachable render node.`,
      subject: {
        kind: "selector-query" as const,
        id: query.id,
      },
      location: query.location,
      evidence: buildSelectorEvidence(context, query),
      traces: buildCompoundSelectorTraces(query),
      data: {
        selectorText: query.selectorText,
        requiredClassNames:
          query.constraint?.kind === "same-node-class-conjunction"
            ? query.constraint.classNames
            : [],
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

function buildCompoundSelectorTraces(
  query: RuleContext["analysis"]["entities"]["selectorQueries"][number],
): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:compound-selector-never-matched:${query.id}`,
      category: "rule-evaluation",
      summary: `compound selector "${query.selectorText}" had no same-node class conjunction match`,
      anchor: query.location,
      children: [
        ...query.traces,
        {
          traceId: `rule-evaluation:compound-selector-never-matched:${query.id}:result`,
          category: "rule-evaluation",
          summary: "same-node class conjunction outcome was no-match-under-bounded-analysis",
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
        ruleId: "compound-selector-never-matched",
        selectorQueryId: query.id,
        selectorText: query.selectorText,
      },
    },
  ];
}
