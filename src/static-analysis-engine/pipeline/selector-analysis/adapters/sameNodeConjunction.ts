import type { RenderNode, RenderSubtree } from "../../render-ir/types.js";
import type { ParsedSelectorQuery, SelectorQueryResult } from "../types.js";
import { mergeBranchEvaluations, mergeInspectionEvaluations } from "../renderInspection.js";
import { evaluateClassRequirement } from "../selectorEvaluationUtils.js";

type SameNodeConstraint = Extract<
  ParsedSelectorQuery["constraint"],
  { kind: "same-node-class-conjunction" }
>;

export function analyzeSameNodeClassConjunction(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: SameNodeConstraint;
  renderSubtrees: RenderSubtree[];
}): SelectorQueryResult {
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;

  for (const subtree of input.renderSubtrees) {
    const evaluation = inspectNodeForSameNodeConstraint(subtree.root, input.constraint.classNames);
    if (evaluation === "match") {
      return {
        selectorText: input.selectorQuery.selectorText,
        source: input.selectorQuery.source,
        constraint: input.constraint,
        outcome: "match",
        status: "resolved",
        confidence: "high",
        reasons: [
          `found a rendered element with all required classes: ${input.constraint.classNames.join(", ")}`,
        ],
      };
    }

    if (evaluation === "possible-match") {
      sawPossibleMatch = true;
    }

    if (evaluation === "unsupported") {
      sawUnsupportedDynamicClass = true;
    }
  }

  if (sawPossibleMatch) {
    return {
      selectorText: input.selectorQuery.selectorText,
      source: input.selectorQuery.source,
      constraint: input.constraint,
      outcome: "possible-match",
      status: "resolved",
      confidence: "medium",
      reasons: [
        `at least one rendered element may emit all required classes together: ${input.constraint.classNames.join(", ")}`,
      ],
    };
  }

  if (sawUnsupportedDynamicClass) {
    return {
      selectorText: input.selectorQuery.selectorText,
      source: input.selectorQuery.source,
      constraint: input.constraint,
      outcome: "possible-match",
      status: "unsupported",
      confidence: "low",
      reasons: [
        "encountered unsupported dynamic class construction while checking same-node class conjunction",
      ],
    };
  }

  return {
    selectorText: input.selectorQuery.selectorText,
    source: input.selectorQuery.source,
    constraint: input.constraint,
    outcome: "no-match-under-bounded-analysis",
    status: "resolved",
    confidence: "high",
    reasons: [
      `no rendered element emitted all required classes together: ${input.constraint.classNames.join(", ")}`,
    ],
  };
}

function inspectNodeForSameNodeConstraint(
  node: RenderNode,
  classNames: string[],
): "match" | "possible-match" | "unsupported" | "no-match" {
  if (node.kind === "element") {
    const evaluation = evaluateClassRequirement(node.className, classNames);
    if (evaluation !== "no-match") {
      return evaluation;
    }
  }

  if (node.kind === "conditional") {
    const whenTrue = inspectNodeForSameNodeConstraint(node.whenTrue, classNames);
    const whenFalse = inspectNodeForSameNodeConstraint(node.whenFalse, classNames);
    return mergeBranchEvaluations(whenTrue, whenFalse);
  }

  if (node.kind === "fragment") {
    return mergeInspectionEvaluations(
      node.children.map((child) => inspectNodeForSameNodeConstraint(child, classNames)),
    );
  }

  if (node.kind === "element") {
    return mergeInspectionEvaluations(
      node.children.map((child) => inspectNodeForSameNodeConstraint(child, classNames)),
    );
  }

  return "no-match";
}
