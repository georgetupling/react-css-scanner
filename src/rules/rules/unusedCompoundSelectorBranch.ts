import type {
  AnalysisTrace,
  SelectorBranchReachability,
} from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  buildReachabilitySelectorEvidence,
  getProjectSelectorBranchForReachability,
  getSelectorReachabilityBranches,
  isReachabilityMatched,
  type ProjectSelectorBranch,
} from "./selectorReachabilityRuleUtils.js";

export const unusedCompoundSelectorBranchRule: RuleDefinition = {
  id: "unused-compound-selector-branch",
  run(context) {
    return runUnusedCompoundSelectorBranchRule(context);
  },
};

function runUnusedCompoundSelectorBranchRule(context: RuleContext): UnresolvedFinding[] {
  const findings: UnresolvedFinding[] = [];
  const branchesByRuleKey = new Map<string, SelectorBranchReachability[]>();

  for (const branch of getSelectorReachabilityBranches(context)) {
    const branches = branchesByRuleKey.get(branch.ruleKey) ?? [];
    branches.push(branch);
    branchesByRuleKey.set(branch.ruleKey, branches);
  }

  for (const branches of branchesByRuleKey.values()) {
    if (branches.length < 2) {
      continue;
    }

    const usefulBranches = branches.filter(isReachabilityMatched);
    if (usefulBranches.length === 0) {
      continue;
    }

    for (const branch of branches) {
      if (branch.status !== "not-matchable" || branch.requirement.kind === "unsupported") {
        continue;
      }

      const projectBranch = getProjectSelectorBranchForReachability(context, branch);
      const projectUsefulBranches = usefulBranches
        .map((usefulBranch) => getProjectSelectorBranchForReachability(context, usefulBranch))
        .filter((candidate): candidate is ProjectSelectorBranch => Boolean(candidate));

      findings.push({
        id: `unused-compound-selector-branch:${projectBranch?.id ?? branch.selectorBranchNodeId}`,
        ruleId: "unused-compound-selector-branch",
        confidence: branch.confidence,
        message: `Selector branch "${branch.branchText}" appears unused while another branch in "${branch.selectorListText}" can match.`,
        subject: projectBranch
          ? {
              kind: "selector-branch",
              id: projectBranch.id,
            }
          : {
              kind: "selector-branch",
              id: branch.selectorBranchNodeId,
            },
        location: branch.location,
        evidence: buildReachabilitySelectorEvidence({
          context,
          projectBranch,
          extraBranches: projectUsefulBranches,
        }),
        traces:
          context.includeTraces === false
            ? []
            : buildUnusedBranchTraces({
                branch,
                projectBranch,
                usefulBranches,
                projectUsefulBranches,
              }),
        data: {
          selectorText: branch.branchText,
          selectorListText: branch.selectorListText,
          branchIndex: branch.branchIndex,
          branchCount: branch.branchCount,
          matchingBranchIds: projectUsefulBranches.map((usefulBranch) => usefulBranch.id),
          selectorReachabilityStatus: branch.status,
          selectorBranchNodeId: branch.selectorBranchNodeId,
          reasons: projectBranch?.reasons ?? [],
        },
      });
    }
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function buildUnusedBranchTraces(input: {
  branch: SelectorBranchReachability;
  projectBranch?: ProjectSelectorBranch;
  usefulBranches: SelectorBranchReachability[];
  projectUsefulBranches: ProjectSelectorBranch[];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:unused-compound-selector-branch:${input.projectBranch?.id ?? input.branch.selectorBranchNodeId}`,
      category: "rule-evaluation",
      summary: `selector branch "${input.branch.branchText}" had no bounded match, but another branch in the selector list did`,
      anchor: input.branch.location,
      children: [
        ...(input.projectBranch?.traces ?? []),
        ...input.projectUsefulBranches.flatMap((branch) => branch.traces),
        {
          traceId: `rule-evaluation:unused-compound-selector-branch:${input.projectBranch?.id ?? input.branch.selectorBranchNodeId}:sibling-branch-check`,
          category: "rule-evaluation",
          summary: "at least one sibling selector branch had a bounded match or possible match",
          anchor: input.branch.location,
          children: [],
          metadata: {
            selectorText: input.branch.branchText,
            selectorListText: input.branch.selectorListText,
            matchingBranchIds: input.projectUsefulBranches.map((branch) => branch.id),
            matchingSelectorReachabilityBranchIds: input.usefulBranches.map(
              (branch) => branch.selectorBranchNodeId,
            ),
          },
        },
      ],
      metadata: {
        ruleId: "unused-compound-selector-branch",
        selectorBranchId: input.projectBranch?.id,
        selectorReachabilityBranchId: input.branch.selectorBranchNodeId,
        selectorQueryId: input.projectBranch?.selectorQueryId,
        selectorText: input.branch.branchText,
      },
    },
  ];
}
