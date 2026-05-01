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

export const compoundSelectorNeverMatchedRule: RuleDefinition = {
  id: "compound-selector-never-matched",
  run(context) {
    return runCompoundSelectorNeverMatchedRule(context);
  },
};

function runCompoundSelectorNeverMatchedRule(context: RuleContext): UnresolvedFinding[] {
  return getSelectorReachabilityBranches(context)
    .filter((branch) => branch.status === "not-matchable")
    .filter(
      (branch) =>
        branch.branchCount === 1 &&
        branch.requirement.kind === "same-node-class-conjunction" &&
        branch.requirement.classNames.length > 1,
    )
    .map((branch): UnresolvedFinding => {
      const query = getProjectSelectorQueryForReachability(context, branch);

      return {
        id: `compound-selector-never-matched:${query?.id ?? branch.selectorBranchNodeId}`,
        ruleId: "compound-selector-never-matched" as const,
        confidence: branch.confidence,
        message: `Compound selector "${branch.branchText}" requires classes that are never emitted together on one known reachable render node.`,
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
          context.includeTraces === false ? [] : buildCompoundSelectorTraces({ branch, query }),
        data: {
          selectorText: branch.branchText,
          requiredClassNames:
            branch.requirement.kind === "same-node-class-conjunction"
              ? branch.requirement.classNames
              : [],
          selectorReachabilityStatus: branch.status,
          selectorBranchNodeId: branch.selectorBranchNodeId,
          reasons: query?.reasons ?? [],
        },
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildCompoundSelectorTraces(input: {
  branch: SelectorBranchReachability;
  query?: SelectorQueryAnalysis;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:compound-selector-never-matched:${input.query?.id ?? input.branch.selectorBranchNodeId}`,
      category: "rule-evaluation",
      summary: `compound selector "${input.branch.branchText}" had no same-node class conjunction match`,
      anchor: input.branch.location,
      children: [
        ...(input.query?.traces ?? []),
        {
          traceId: `rule-evaluation:compound-selector-never-matched:${input.query?.id ?? input.branch.selectorBranchNodeId}:result`,
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
        ruleId: "compound-selector-never-matched",
        selectorQueryId: input.query?.id,
        selectorBranchNodeId: input.branch.selectorBranchNodeId,
        selectorText: input.branch.branchText,
      },
    },
  ];
}
