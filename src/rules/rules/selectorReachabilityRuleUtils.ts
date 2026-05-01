import {
  type SelectorBranchAnalysis,
  type SelectorBranchReachability,
  type SelectorQueryAnalysis,
} from "../../static-analysis-engine/index.js";
import {
  getProjectSelectorBranchForReachability as queryProjectSelectorBranchForReachability,
  getProjectSelectorQueryForReachability as queryProjectSelectorQueryForReachability,
  getSelectorReachabilityBranches as querySelectorReachabilityBranches,
  getStylesheetById,
} from "../analysisQueries.js";
import type { RuleContext, UnresolvedFinding } from "../types.js";

export type ProjectSelectorBranch = SelectorBranchAnalysis;

export type ProjectSelectorQuery = SelectorQueryAnalysis;

export function getSelectorReachabilityBranches(
  context: RuleContext,
): SelectorBranchReachability[] {
  return querySelectorReachabilityBranches(context.analysisEvidence);
}

export function getProjectSelectorBranchForReachability(
  context: RuleContext,
  branch: SelectorBranchReachability,
): ProjectSelectorBranch | undefined {
  return queryProjectSelectorBranchForReachability(context.analysisEvidence, branch);
}

export function getProjectSelectorQueryForReachability(
  context: RuleContext,
  branch: SelectorBranchReachability,
): ProjectSelectorQuery | undefined {
  return queryProjectSelectorQueryForReachability(context.analysisEvidence, branch);
}

export function buildReachabilitySelectorEvidence(input: {
  context: RuleContext;
  projectBranch?: ProjectSelectorBranch;
  projectQuery?: ProjectSelectorQuery;
  extraBranches?: ProjectSelectorBranch[];
}): UnresolvedFinding["evidence"] {
  const evidence: UnresolvedFinding["evidence"] = [];
  const stylesheetId = input.projectBranch?.stylesheetId ?? input.projectQuery?.stylesheetId;

  if (stylesheetId && getStylesheetById(input.context.analysisEvidence, stylesheetId)) {
    evidence.push({
      kind: "stylesheet",
      id: stylesheetId,
    });
  }

  for (const branch of input.extraBranches ?? []) {
    evidence.push({
      kind: "selector-branch",
      id: branch.id,
    });
  }

  return evidence;
}

export function isReachabilityMatched(branch: SelectorBranchReachability): boolean {
  return (
    branch.status === "definitely-matchable" ||
    branch.status === "possibly-matchable" ||
    branch.status === "only-matches-in-unknown-context"
  );
}
