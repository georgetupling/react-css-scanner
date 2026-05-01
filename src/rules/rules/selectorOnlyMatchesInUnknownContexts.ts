import type {
  AnalysisTrace,
  SelectorBranchReachability,
  SelectorQueryAnalysis,
} from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  buildReachabilitySelectorEvidence,
  getProjectSelectorQueryForReachability,
  getSelectorReachabilityBranches,
} from "./selectorReachabilityRuleUtils.js";

export const selectorOnlyMatchesInUnknownContextsRule: RuleDefinition = {
  id: "selector-only-matches-in-unknown-contexts",
  run(context) {
    return runSelectorOnlyMatchesInUnknownContextsRule(context);
  },
};

function runSelectorOnlyMatchesInUnknownContextsRule(context: RuleContext): UnresolvedFinding[] {
  return getSelectorReachabilityBranches(context)
    .filter((branch) => branch.status === "only-matches-in-unknown-context")
    .map((branch): UnresolvedFinding => {
      const query = getProjectSelectorQueryForReachability(context, branch);

      return {
        id: `selector-only-matches-in-unknown-contexts:${query?.id ?? branch.selectorBranchNodeId}`,
        ruleId: "selector-only-matches-in-unknown-contexts" as const,
        confidence: "low" as const,
        message: `Selector "${branch.branchText}" may match, but only through render or selector context the scanner could not fully resolve.`,
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
            : buildSelectorOnlyMatchesInUnknownContextsTraces({ branch, query }),
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

function buildSelectorOnlyMatchesInUnknownContextsTraces(input: {
  branch: SelectorBranchReachability;
  query?: SelectorQueryAnalysis;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:selector-only-matches-in-unknown-contexts:${input.query?.id ?? input.branch.selectorBranchNodeId}`,
      category: "rule-evaluation",
      summary: `selector "${input.branch.branchText}" could only be classified as a possible match because part of the selector context is unknown`,
      anchor: input.branch.location,
      children: [
        ...(input.query?.traces ?? []),
        {
          traceId: `rule-evaluation:selector-only-matches-in-unknown-contexts:${input.query?.id ?? input.branch.selectorBranchNodeId}:result`,
          category: "rule-evaluation",
          summary: "selector reachability branch status was only-matches-in-unknown-context",
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
        ruleId: "selector-only-matches-in-unknown-contexts",
        selectorQueryId: input.query?.id,
        selectorBranchNodeId: input.branch.selectorBranchNodeId,
        selectorText: input.branch.branchText,
      },
    },
  ];
}
