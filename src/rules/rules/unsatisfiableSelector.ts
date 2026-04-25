import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const unsatisfiableSelectorRule: RuleDefinition = {
  id: "unsatisfiable-selector",
  run(context) {
    return runUnsatisfiableSelectorRule(context);
  },
};

function runUnsatisfiableSelectorRule(context: RuleContext): UnresolvedFinding[] {
  return context.analysis.entities.selectorQueries
    .filter((query) => query.sourceResult.source.kind === "css-source")
    .filter((query) => query.status === "resolved")
    .filter((query) => query.outcome === "no-match-under-bounded-analysis")
    .filter((query) => query.constraint?.kind !== "unsupported")
    .filter((query) => query.constraint?.kind !== "same-node-class-conjunction")
    .map((query) => ({
      id: `unsatisfiable-selector:${query.id}`,
      ruleId: "unsatisfiable-selector" as const,
      confidence: query.confidence,
      message: `Selector "${query.selectorText}" cannot match any known reachable render structure under bounded analysis.`,
      subject: {
        kind: "selector-query" as const,
        id: query.id,
      },
      location: query.location,
      evidence: buildSelectorEvidence(context, query),
      traces: buildUnsatisfiableSelectorTraces(query),
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

function buildUnsatisfiableSelectorTraces(
  query: RuleContext["analysis"]["entities"]["selectorQueries"][number],
): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:unsatisfiable-selector:${query.id}`,
      category: "rule-evaluation",
      summary: `selector "${query.selectorText}" had no match under bounded selector analysis`,
      anchor: query.location,
      children: [
        ...query.traces,
        {
          traceId: `rule-evaluation:unsatisfiable-selector:${query.id}:result`,
          category: "rule-evaluation",
          summary: "selector query outcome was no-match-under-bounded-analysis",
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
        ruleId: "unsatisfiable-selector",
        selectorQueryId: query.id,
        selectorText: query.selectorText,
      },
    },
  ];
}
