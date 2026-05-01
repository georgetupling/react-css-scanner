import {
  selectorBranchSourceKey,
  type AnalysisTrace,
  type SelectorBranchReachability,
} from "../../static-analysis-engine/index.js";
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
    .filter((query) => query.constraint?.kind !== "unsupported")
    .filter((query) => query.constraint?.kind !== "same-node-class-conjunction")
    .filter(
      (query) =>
        query.sourceResult.source.kind !== "css-source" ||
        (query.sourceResult.source.branchCount ?? 1) === 1,
    )
    .map((query): UnresolvedFinding | undefined => {
      const branch = getSelectorReachabilityBranch(context, query);
      if (branch) {
        if (branch.status !== "not-matchable") {
          return undefined;
        }

        return {
          id: `unsatisfiable-selector:${query.id}`,
          ruleId: "unsatisfiable-selector" as const,
          confidence: branch.confidence,
          message: `Selector "${query.selectorText}" cannot match any known reachable render structure under bounded analysis.`,
          subject: {
            kind: "selector-query" as const,
            id: query.id,
          },
          location: query.location,
          evidence: buildSelectorEvidence(context, query),
          traces:
            context.includeTraces === false ? [] : buildUnsatisfiableSelectorTraces(query, branch),
          data: {
            selectorText: query.selectorText,
            constraint: query.constraint,
            outcome: query.outcome,
            status: query.status,
            selectorReachabilityStatus: branch.status,
            selectorBranchNodeId: branch.selectorBranchNodeId,
            reasons: query.sourceResult.reasons,
          },
        };
      }

      if (query.status !== "resolved" || query.outcome !== "no-match-under-bounded-analysis") {
        return undefined;
      }

      return {
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
        traces: context.includeTraces === false ? [] : buildUnsatisfiableSelectorTraces(query),
        data: {
          selectorText: query.selectorText,
          constraint: query.constraint,
          outcome: query.outcome,
          status: query.status,
          reasons: query.sourceResult.reasons,
        },
      };
    })
    .filter((finding): finding is UnresolvedFinding => Boolean(finding))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function getSelectorReachabilityBranch(
  context: RuleContext,
  query: RuleContext["analysis"]["entities"]["selectorQueries"][number],
): SelectorBranchReachability | undefined {
  if (query.sourceResult.source.kind !== "css-source") {
    return undefined;
  }

  const selectorReachability = context.analysis.evidence.selectorReachability;
  if (!selectorReachability) {
    return undefined;
  }

  return selectorReachability.indexes.branchReachabilityBySourceKey.get(
    selectorBranchSourceKey({
      ruleKey: query.sourceResult.source.ruleKey,
      branchIndex: query.sourceResult.source.branchIndex,
      selectorText: query.selectorText,
      location: query.sourceResult.source.selectorAnchor,
    }),
  );
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
  branch?: SelectorBranchReachability,
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
          summary: branch
            ? "selector reachability branch status was not-matchable"
            : "selector query outcome was no-match-under-bounded-analysis",
          anchor: query.location,
          children: [],
          metadata: {
            selectorText: query.selectorText,
            outcome: query.outcome,
            status: query.status,
            ...(branch
              ? {
                  selectorReachabilityStatus: branch.status,
                  selectorBranchNodeId: branch.selectorBranchNodeId,
                }
              : {}),
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
