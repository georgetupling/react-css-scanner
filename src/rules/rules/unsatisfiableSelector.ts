import type {
  AnalysisTrace,
  SelectorBranchReachability,
  SelectorQueryAnalysis,
} from "../../static-analysis-engine/index.js";
import { isProjectLocalStylesheetBranch } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  buildReachabilitySelectorEvidence,
  getProjectSelectorQueryForReachability,
  getSelectorReachabilityBranches,
} from "./selectorReachabilityRuleUtils.js";

export const unsatisfiableSelectorRule: RuleDefinition = {
  id: "unsatisfiable-selector",
  run(context) {
    return runUnsatisfiableSelectorRule(context);
  },
};

function runUnsatisfiableSelectorRule(context: RuleContext): UnresolvedFinding[] {
  return getSelectorReachabilityBranches(context)
    .filter((branch) => branch.status === "not-matchable")
    .filter((branch) => isProjectLocalStylesheetBranch(context.analysisEvidence, branch))
    .filter((branch) => branch.requirement.kind !== "unsupported")
    .filter((branch) => branch.requirement.kind !== "same-node-class-conjunction")
    .filter((branch) => branch.branchCount === 1)
    .map((branch): UnresolvedFinding => {
      const query = getProjectSelectorQueryForReachability(context, branch);
      return {
        id: `unsatisfiable-selector:${query?.id ?? branch.selectorBranchNodeId}`,
        ruleId: "unsatisfiable-selector" as const,
        confidence: branch.confidence,
        message: `Selector "${branch.branchText}" cannot match any known reachable render structure under bounded analysis.`,
        subject: query
          ? {
              kind: "selector-query" as const,
              id: query.id,
            }
          : {
              kind: "selector-branch" as const,
              id: branch.selectorBranchNodeId,
            },
        location: branch.location,
        evidence: buildReachabilitySelectorEvidence({ context, projectQuery: query }),
        traces:
          context.includeTraces === false
            ? []
            : buildUnsatisfiableSelectorTraces({ branch, query }),
        data: {
          selectorText: branch.branchText,
          requirement: branch.requirement,
          selectorReachabilityStatus: branch.status,
          selectorBranchNodeId: branch.selectorBranchNodeId,
          reasons: query?.reasons ?? [],
        },
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildUnsatisfiableSelectorTraces(input: {
  branch: SelectorBranchReachability;
  query?: SelectorQueryAnalysis;
}): AnalysisTrace[] {
  const selectorMatchTraces = collectTracesByCategory(input.query?.traces ?? [], "selector-match");

  return [
    {
      traceId: `rule-evaluation:unsatisfiable-selector:${input.query?.id ?? input.branch.selectorBranchNodeId}`,
      category: "rule-evaluation",
      summary: `selector "${input.branch.branchText}" had no match under bounded selector analysis`,
      anchor: input.branch.location,
      children: [
        ...(selectorMatchTraces.length > 0
          ? selectorMatchTraces
          : [
              {
                traceId: `selector-match:unsatisfiable-selector:${input.query?.id ?? input.branch.selectorBranchNodeId}`,
                category: "selector-match" as const,
                summary: `no bounded selector match was found for "${input.branch.branchText}"`,
                anchor: input.branch.location,
                children: [],
                metadata: {
                  selectorText: input.branch.branchText,
                  selectorReachabilityStatus: input.branch.status,
                  selectorBranchNodeId: input.branch.selectorBranchNodeId,
                },
              },
              ...(input.query?.traces ?? []),
            ]),
        {
          traceId: `rule-evaluation:unsatisfiable-selector:${input.query?.id ?? input.branch.selectorBranchNodeId}:result`,
          category: "rule-evaluation",
          summary: "selector reachability branch status was not-matchable",
          anchor: input.branch.location,
          children: [],
          metadata: {
            selectorText: input.branch.branchText,
            selectorReachabilityStatus: input.branch.status,
            selectorBranchNodeId: input.branch.selectorBranchNodeId,
            reasons: input.query?.reasons ?? [],
          },
        },
      ],
      metadata: {
        ruleId: "unsatisfiable-selector",
        selectorQueryId: input.query?.id,
        selectorBranchNodeId: input.branch.selectorBranchNodeId,
        selectorText: input.branch.branchText,
      },
    },
  ];
}

function collectTracesByCategory(
  traces: AnalysisTrace[],
  category: AnalysisTrace["category"],
): AnalysisTrace[] {
  const results: AnalysisTrace[] = [];
  const queue = [...traces];
  while (queue.length > 0) {
    const trace = queue.shift();
    if (!trace) {
      continue;
    }

    if (trace.category === category) {
      results.push(trace);
    }
    if (trace.children.length > 0) {
      queue.push(...trace.children);
    }
  }
  return results;
}
