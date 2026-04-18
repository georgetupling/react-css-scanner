import type { RenderNode, RenderSubtree } from "../../render-ir/types.js";
import type { ParsedSelectorQuery, SelectorQueryResult } from "../types.js";
import type { RenderNodeInspectionAdapter } from "../renderInspection.js";
import { inspectRenderNode } from "../renderInspection.js";
import {
  combinePresence,
  evaluateSingleClassPresence,
  type PresenceEvaluation,
} from "../selectorEvaluationUtils.js";

type ParentChildConstraint = Extract<ParsedSelectorQuery["constraint"], { kind: "parent-child" }>;

type ParentChildState = {
  parentClassName: string;
  childClassName: string;
};

export function analyzeParentChildConstraint(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: ParentChildConstraint;
  renderSubtrees: RenderSubtree[];
}): SelectorQueryResult {
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;

  for (const subtree of input.renderSubtrees) {
    const evaluation = inspectRenderNode({
      node: subtree.root,
      state: {
        parentClassName: input.constraint.parentClassName,
        childClassName: input.constraint.childClassName,
      },
      adapter: parentChildConstraintAdapter,
    });

    if (evaluation === "match") {
      return {
        selectorText: input.selectorQuery.selectorText,
        source: input.selectorQuery.source,
        constraint: input.constraint,
        outcome: "match",
        status: "resolved",
        confidence: "high",
        reasons: [
          `found a rendered child with class "${input.constraint.childClassName}" directly under a parent with class "${input.constraint.parentClassName}"`,
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
        `found a plausible direct parent-child match for "${input.constraint.parentClassName} > ${input.constraint.childClassName}" on at least one bounded path`,
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
        "encountered unsupported dynamic class construction while checking direct parent-child structure",
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
      `no bounded rendered path satisfied parent "${input.constraint.parentClassName}" with direct child "${input.constraint.childClassName}"`,
    ],
  };
}

const parentChildConstraintAdapter: RenderNodeInspectionAdapter<ParentChildState> = {
  inspectElement({ node, state, helpers }) {
    const parentPresence = evaluateSingleClassPresence(node.className, state.parentClassName);
    if (parentPresence !== "no-match") {
      const directChildEvaluation = helpers.inspectDirectChildren(node.children, (child) =>
        inspectDirectChildForClassRequirement(child, state.childClassName, parentPresence),
      );

      if (directChildEvaluation !== "no-match") {
        return directChildEvaluation;
      }
    }

    const childEvaluation = helpers.inspectChildren(node.children, state);
    if (childEvaluation !== "no-match") {
      return childEvaluation;
    }

    if (parentPresence === "unsupported") {
      return "unsupported";
    }

    return "no-match";
  },
};

function inspectDirectChildForClassRequirement(
  node: RenderNode,
  childClassName: string,
  parentPresence: Exclude<PresenceEvaluation, "no-match">,
): "match" | "possible-match" | "unsupported" | "no-match" {
  if (node.kind === "conditional") {
    const whenTrue = inspectDirectChildForClassRequirement(
      node.whenTrue,
      childClassName,
      parentPresence,
    );
    const whenFalse = inspectDirectChildForClassRequirement(
      node.whenFalse,
      childClassName,
      parentPresence,
    );
    return whenTrue === "match" && whenFalse === "match"
      ? "match"
      : whenTrue === "match" || whenFalse === "match"
        ? "possible-match"
        : whenTrue === "possible-match" || whenFalse === "possible-match"
          ? "possible-match"
          : whenTrue === "unsupported" || whenFalse === "unsupported"
            ? "unsupported"
            : "no-match";
  }

  if (node.kind === "fragment") {
    const evaluations = node.children.map((child) =>
      inspectDirectChildForClassRequirement(child, childClassName, parentPresence),
    );
    if (evaluations.includes("match")) {
      return "match";
    }
    if (evaluations.includes("possible-match")) {
      return "possible-match";
    }
    if (evaluations.includes("unsupported")) {
      return "unsupported";
    }
    return "no-match";
  }

  if (node.kind !== "element") {
    return "no-match";
  }

  return combinePresence(
    parentPresence,
    evaluateSingleClassPresence(node.className, childClassName),
  );
}
