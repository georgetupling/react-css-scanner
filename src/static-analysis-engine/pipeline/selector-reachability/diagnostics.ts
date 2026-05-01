import type { ParsedSelectorBranch } from "../../libraries/selector-parsing/index.js";
import type { SelectorBranchNode } from "../fact-graph/index.js";
import { selectorReachabilityDiagnosticId } from "./ids.js";
import type { StructuralConstraint } from "./structuralMatches.js";
import type { SelectorReachabilityDiagnostic } from "./types.js";

export function buildDiagnostics(input: {
  branch: SelectorBranchNode;
  parsedBranch: ParsedSelectorBranch | undefined;
  structuralConstraint: StructuralConstraint | undefined;
}): SelectorReachabilityDiagnostic[] {
  const unsupportedReason = getUnsupportedSelectorReason(input);
  if (!unsupportedReason) {
    return [];
  }

  return [
    {
      id: selectorReachabilityDiagnosticId({
        selectorBranchNodeId: input.branch.id,
        code: "unsupported-selector-branch",
      }),
      selectorBranchNodeId: input.branch.id,
      severity: "debug",
      code: "unsupported-selector-branch",
      message: unsupportedReason,
      ...(input.branch.location ? { location: input.branch.location } : {}),
      traces: [],
    },
  ];
}

function getUnsupportedSelectorReason(input: {
  branch: SelectorBranchNode;
  parsedBranch: ParsedSelectorBranch | undefined;
  structuralConstraint: StructuralConstraint | undefined;
}): string | undefined {
  const parsedBranch = input.parsedBranch;
  if (!parsedBranch) {
    return "selector branch could not be parsed for bounded selector reachability";
  }

  if (input.branch.hasUnknownSemantics || parsedBranch.hasUnknownSemantics) {
    return "selector branch contains unsupported selector semantics";
  }

  if (parsedBranch.hasSubjectModifiers) {
    return "selector branch contains subject modifiers outside bounded selector reachability";
  }

  if (parsedBranch.negativeClassNames.length > 0) {
    return "selector branch contains negative class constraints outside bounded selector reachability";
  }

  if (parsedBranch.steps.length === 1) {
    return undefined;
  }

  if (parsedBranch.steps.length !== 2) {
    return "selector branch has more structural steps than bounded selector reachability supports";
  }

  if (!input.structuralConstraint) {
    return "selector branch has a structural shape outside bounded selector reachability";
  }

  return undefined;
}
