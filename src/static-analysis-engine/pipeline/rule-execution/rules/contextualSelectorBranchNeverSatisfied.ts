import type { SelectorConstraint, SelectorQueryResult } from "../../selector-analysis/types.js";
import type { ExperimentalRuleResult } from "../types.js";

export function runContextualSelectorBranchNeverSatisfiedRule(
  selectorQueryResult: SelectorQueryResult,
): ExperimentalRuleResult | undefined {
  if (
    selectorQueryResult.source.kind !== "css-source" ||
    selectorQueryResult.outcome !== "no-match-under-bounded-analysis" ||
    selectorQueryResult.status !== "resolved"
  ) {
    return undefined;
  }

  if (!isContextualStructuralConstraint(selectorQueryResult.constraint)) {
    return undefined;
  }

  return {
    ruleId: "contextual-selector-branch-never-satisfied",
    severity: "info",
    confidence: selectorQueryResult.confidence,
    summary: `Contextual selector branch "${selectorQueryResult.selectorText}" appears never satisfied under bounded analysis.`,
    reasons: [
      "experimental Phase 7 pilot rule derived from bounded structural selector satisfiability analysis",
      ...selectorQueryResult.reasons,
    ],
    primaryLocation: {
      filePath: selectorQueryResult.source.selectorAnchor?.filePath,
      line: selectorQueryResult.source.selectorAnchor?.startLine,
    },
    selectorText: selectorQueryResult.selectorText,
    selectorQueryResult,
  };
}

function isContextualStructuralConstraint(
  constraint: SelectorQueryResult["constraint"],
): constraint is Exclude<SelectorConstraint, { kind: "same-node-class-conjunction" }> {
  return Boolean(
    constraint &&
    "kind" in constraint &&
    (constraint.kind === "ancestor-descendant" ||
      constraint.kind === "parent-child" ||
      constraint.kind === "sibling"),
  );
}
