import type { RenderNode, RenderSubtree } from "../../render-ir/types.js";
import type { ParsedSelectorQuery, SelectorQueryResult } from "../types.js";
import { combinePresence, evaluateSingleClassPresence } from "../selectorEvaluationUtils.js";
import { mergeInspectionEvaluations } from "../renderInspection.js";

type SiblingConstraint = Extract<ParsedSelectorQuery["constraint"], { kind: "sibling" }>;

type SequenceCertainty = "definite" | "possible";

type SiblingSequence = {
  nodes: RenderNode[];
  certainty: SequenceCertainty;
};

export function analyzeSiblingConstraint(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: SiblingConstraint;
  renderSubtrees: RenderSubtree[];
}): SelectorQueryResult {
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;

  for (const subtree of input.renderSubtrees) {
    const evaluation = inspectNodeForSiblingConstraint({
      node: subtree.root,
      constraint: input.constraint,
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
          `found a rendered ${describeRelation(input.constraint.relation)} sibling with class "${input.constraint.rightClassName}" after a sibling with class "${input.constraint.leftClassName}"`,
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
        `found a plausible ${describeRelation(input.constraint.relation)} sibling match for "${input.constraint.leftClassName}${input.constraint.relation === "adjacent" ? " + " : " ~ "}${input.constraint.rightClassName}" on at least one bounded path`,
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
        `encountered unsupported dynamic class construction while checking ${describeRelation(input.constraint.relation)} sibling structure`,
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
      `no bounded rendered path satisfied ${describeRelation(input.constraint.relation)} sibling "${input.constraint.leftClassName}" with sibling "${input.constraint.rightClassName}"`,
    ],
  };
}

function inspectNodeForSiblingConstraint(input: {
  node: RenderNode;
  constraint: SiblingConstraint;
}): "match" | "possible-match" | "unsupported" | "no-match" {
  const { node, constraint } = input;

  if (node.kind === "conditional") {
    return mergeInspectionEvaluations([
      inspectNodeForSiblingConstraint({
        node: node.whenTrue,
        constraint,
      }),
      inspectNodeForSiblingConstraint({
        node: node.whenFalse,
        constraint,
      }),
    ]);
  }

  if (node.kind === "fragment") {
    return inspectSiblingContainer(node.children, constraint);
  }

  if (node.kind !== "element") {
    return "no-match";
  }

  const localEvaluation = inspectSiblingContainer(node.children, constraint);
  if (localEvaluation !== "no-match") {
    return localEvaluation;
  }

  return mergeInspectionEvaluations(
    node.children.map((child) =>
      inspectNodeForSiblingConstraint({
        node: child,
        constraint,
      }),
    ),
  );
}

function inspectSiblingContainer(
  children: RenderNode[],
  constraint: SiblingConstraint,
): "match" | "possible-match" | "unsupported" | "no-match" {
  const sequences = expandSiblingSequences(children);
  let sawPossible = false;
  let sawUnsupported = false;

  for (const sequence of sequences) {
    const evaluation = evaluateSiblingSequence(sequence, constraint);
    if (evaluation === "match") {
      return sequence.certainty === "definite" ? "match" : "possible-match";
    }

    if (evaluation === "possible-match") {
      sawPossible = true;
    }

    if (evaluation === "unsupported") {
      sawUnsupported = true;
    }
  }

  if (sawPossible) {
    return "possible-match";
  }

  if (sawUnsupported) {
    return "unsupported";
  }

  return "no-match";
}

function expandSiblingSequences(children: RenderNode[]): SiblingSequence[] {
  let sequences: SiblingSequence[] = [{ nodes: [], certainty: "definite" }];

  for (const child of children) {
    const childSequences = expandNodeIntoSiblingSequences(child);
    const nextSequences: SiblingSequence[] = [];

    for (const sequence of sequences) {
      for (const childSequence of childSequences) {
        nextSequences.push({
          nodes: [...sequence.nodes, ...childSequence.nodes],
          certainty:
            sequence.certainty === "possible" || childSequence.certainty === "possible"
              ? "possible"
              : "definite",
        });
      }
    }

    sequences = nextSequences;
  }

  return sequences;
}

function expandNodeIntoSiblingSequences(node: RenderNode): SiblingSequence[] {
  if (node.kind === "fragment") {
    return expandSiblingSequences(node.children);
  }

  if (node.kind === "conditional") {
    return [
      ...expandNodeIntoSiblingSequences(node.whenTrue).map((sequence) => ({
        ...sequence,
        certainty: "possible" as const,
      })),
      ...expandNodeIntoSiblingSequences(node.whenFalse).map((sequence) => ({
        ...sequence,
        certainty: "possible" as const,
      })),
    ];
  }

  return [
    {
      nodes: [node],
      certainty: "definite",
    },
  ];
}

function evaluateSiblingSequence(
  sequence: SiblingSequence,
  constraint: SiblingConstraint,
): "match" | "possible-match" | "unsupported" | "no-match" {
  const candidatePairs =
    constraint.relation === "adjacent"
      ? sequence.nodes.flatMap((node, index) =>
          index < sequence.nodes.length - 1 ? [[node, sequence.nodes[index + 1]] as const] : [],
        )
      : sequence.nodes.flatMap((leftNode, leftIndex) =>
          sequence.nodes.slice(leftIndex + 1).map((rightNode) => [leftNode, rightNode] as const),
        );

  let sawPossible = false;
  let sawUnsupported = false;

  for (const [leftNode, rightNode] of candidatePairs) {
    const evaluation = evaluateSiblingPair(
      leftNode,
      rightNode,
      constraint.leftClassName,
      constraint.rightClassName,
    );

    if (evaluation === "match") {
      return sequence.certainty === "definite" ? "match" : "possible-match";
    }

    if (evaluation === "possible-match") {
      sawPossible = true;
    }

    if (evaluation === "unsupported") {
      sawUnsupported = true;
    }
  }

  if (sawPossible) {
    return "possible-match";
  }

  if (sawUnsupported) {
    return "unsupported";
  }

  return "no-match";
}

function evaluateSiblingPair(
  leftNode: RenderNode,
  rightNode: RenderNode,
  leftClassName: string,
  rightClassName: string,
): "match" | "possible-match" | "unsupported" | "no-match" {
  if (leftNode.kind !== "element" || rightNode.kind !== "element") {
    return "no-match";
  }

  const leftPresence = evaluateSingleClassPresence(leftNode.className, leftClassName);
  if (leftPresence === "no-match") {
    return "no-match";
  }

  return combinePresence(
    leftPresence,
    evaluateSingleClassPresence(rightNode.className, rightClassName),
  );
}

function describeRelation(relation: SiblingConstraint["relation"]): string {
  return relation === "adjacent" ? "adjacent" : "general";
}
