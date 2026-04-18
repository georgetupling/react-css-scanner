import type { RenderNode, RenderSubtree } from "../../render-ir/types.js";
import type { ParsedSelectorQuery, SelectorQueryResult } from "../types.js";
import {
  combinePresence,
  evaluateSingleClassPresence,
  type PresenceEvaluation,
} from "../selectorEvaluationUtils.js";

type AncestorDescendantConstraint = Extract<
  ParsedSelectorQuery["constraint"],
  { kind: "ancestor-descendant" }
>;

export function analyzeAncestorDescendantConstraint(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: AncestorDescendantConstraint;
  renderSubtrees: RenderSubtree[];
}): SelectorQueryResult {
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;

  for (const subtree of input.renderSubtrees) {
    const evaluation = inspectNodeForAncestorDescendantConstraint({
      node: subtree.root,
      ancestorClassName: input.constraint.ancestorClassName,
      subjectClassName: input.constraint.subjectClassName,
      ancestorStack: [],
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
          `found a rendered descendant with class "${input.constraint.subjectClassName}" under an ancestor with class "${input.constraint.ancestorClassName}"`,
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
        `found a plausible ancestor-descendant match for "${input.constraint.ancestorClassName} ${input.constraint.subjectClassName}" on at least one bounded path`,
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
        "encountered unsupported dynamic class construction while checking ancestor-descendant structure",
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
      `no bounded rendered path satisfied ancestor "${input.constraint.ancestorClassName}" with descendant "${input.constraint.subjectClassName}"`,
    ],
  };
}

function inspectNodeForAncestorDescendantConstraint(input: {
  node: RenderNode;
  ancestorClassName: string;
  subjectClassName: string;
  ancestorStack: Array<Exclude<PresenceEvaluation, "no-match">>;
}): "match" | "possible-match" | "unsupported" | "no-match" {
  const { node, ancestorClassName, subjectClassName, ancestorStack } = input;

  if (node.kind === "conditional") {
    const whenTrue = inspectNodeForAncestorDescendantConstraint({
      ...input,
      node: node.whenTrue,
    });
    const whenFalse = inspectNodeForAncestorDescendantConstraint({
      ...input,
      node: node.whenFalse,
    });
    return mergeEvaluations([whenTrue, whenFalse], true);
  }

  if (node.kind === "fragment") {
    return mergeEvaluations(
      node.children.map((child) =>
        inspectNodeForAncestorDescendantConstraint({
          ...input,
          node: child,
        }),
      ),
    );
  }

  if (node.kind !== "element") {
    return "no-match";
  }

  const ancestorPresence = evaluateSingleClassPresence(node.className, ancestorClassName);
  const nextAncestorStack = [...ancestorStack];
  if (ancestorPresence !== "no-match") {
    nextAncestorStack.push(ancestorPresence);
  }

  const subjectPresence = evaluateSingleClassPresence(node.className, subjectClassName);
  const strongestAncestor = strongestAncestorPresence(ancestorStack);

  if (strongestAncestor && subjectPresence !== "no-match") {
    const combined = combinePresence(strongestAncestor, subjectPresence);
    if (combined !== "no-match") {
      return combined;
    }
  }

  const childEvaluation = mergeEvaluations(
    node.children.map((child) =>
      inspectNodeForAncestorDescendantConstraint({
        ...input,
        node: child,
        ancestorStack: nextAncestorStack,
      }),
    ),
  );

  if (childEvaluation !== "no-match") {
    return childEvaluation;
  }

  if (ancestorPresence === "unsupported" || subjectPresence === "unsupported") {
    return "unsupported";
  }

  return "no-match";
}

function strongestAncestorPresence(
  ancestorStack: Array<Exclude<PresenceEvaluation, "no-match">>,
): Exclude<PresenceEvaluation, "no-match"> | undefined {
  if (ancestorStack.includes("definite")) {
    return "definite";
  }

  if (ancestorStack.includes("possible")) {
    return "possible";
  }

  if (ancestorStack.includes("unsupported")) {
    return "unsupported";
  }

  return undefined;
}

function mergeEvaluations(
  evaluations: Array<"match" | "possible-match" | "unsupported" | "no-match">,
  treatAsBranches = false,
): "match" | "possible-match" | "unsupported" | "no-match" {
  if (evaluations.includes("match")) {
    if (treatAsBranches && evaluations.every((evaluation) => evaluation === "match")) {
      return "match";
    }

    return treatAsBranches ? "possible-match" : "match";
  }

  if (evaluations.includes("possible-match")) {
    return "possible-match";
  }

  if (evaluations.includes("unsupported")) {
    return "unsupported";
  }

  return "no-match";
}
