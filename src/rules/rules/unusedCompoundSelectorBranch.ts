import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const unusedCompoundSelectorBranchRule: RuleDefinition = {
  id: "unused-compound-selector-branch",
  run(context) {
    return runUnusedCompoundSelectorBranchRule(context);
  },
};

function runUnusedCompoundSelectorBranchRule(context: RuleContext): UnresolvedFinding[] {
  const findings: UnresolvedFinding[] = [];

  for (const branchIds of context.analysis.indexes.selectorBranchesByRuleKey.values()) {
    const branches = branchIds
      .map((branchId) => context.analysis.indexes.selectorBranchesById.get(branchId))
      .filter((branch): branch is NonNullable<typeof branch> => Boolean(branch));

    if (branches.length < 2) {
      continue;
    }

    const usefulBranches = branches.filter(
      (branch) => branch.outcome === "match" || branch.outcome === "possible-match",
    );
    if (usefulBranches.length === 0) {
      continue;
    }

    for (const branch of branches) {
      if (
        branch.status !== "resolved" ||
        branch.outcome !== "no-match-under-bounded-analysis" ||
        branch.constraint?.kind === "unsupported"
      ) {
        continue;
      }

      findings.push({
        id: `unused-compound-selector-branch:${branch.id}`,
        ruleId: "unused-compound-selector-branch",
        confidence: branch.confidence,
        message: `Selector branch "${branch.selectorText}" appears unused while another branch in "${branch.selectorListText}" can match.`,
        subject: {
          kind: "selector-branch",
          id: branch.id,
        },
        location: branch.location,
        evidence: [
          ...(branch.stylesheetId
            ? [
                {
                  kind: "stylesheet" as const,
                  id: branch.stylesheetId,
                },
              ]
            : []),
          ...usefulBranches.map((usefulBranch) => ({
            kind: "selector-branch" as const,
            id: usefulBranch.id,
          })),
        ],
        traces:
          context.includeTraces === false
            ? []
            : buildUnusedBranchTraces({
                branch,
                usefulBranches,
              }),
        data: {
          selectorText: branch.selectorText,
          selectorListText: branch.selectorListText,
          branchIndex: branch.branchIndex,
          branchCount: branch.branchCount,
          matchingBranchIds: usefulBranches.map((usefulBranch) => usefulBranch.id),
          reasons: branch.sourceQuery.sourceResult.reasons,
        },
      });
    }
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function buildUnusedBranchTraces(input: {
  branch: RuleContext["analysis"]["entities"]["selectorBranches"][number];
  usefulBranches: RuleContext["analysis"]["entities"]["selectorBranches"];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:unused-compound-selector-branch:${input.branch.id}`,
      category: "rule-evaluation",
      summary: `selector branch "${input.branch.selectorText}" had no bounded match, but another branch in the selector list did`,
      anchor: input.branch.location,
      children: [
        ...input.branch.traces,
        ...input.usefulBranches.flatMap((branch) => branch.traces),
        {
          traceId: `rule-evaluation:unused-compound-selector-branch:${input.branch.id}:sibling-branch-check`,
          category: "rule-evaluation",
          summary: "at least one sibling selector branch had a bounded match or possible match",
          anchor: input.branch.location,
          children: [],
          metadata: {
            selectorText: input.branch.selectorText,
            selectorListText: input.branch.selectorListText,
            matchingBranchIds: input.usefulBranches.map((branch) => branch.id),
          },
        },
      ],
      metadata: {
        ruleId: "unused-compound-selector-branch",
        selectorBranchId: input.branch.id,
        selectorQueryId: input.branch.selectorQueryId,
        selectorText: input.branch.selectorText,
      },
    },
  ];
}
