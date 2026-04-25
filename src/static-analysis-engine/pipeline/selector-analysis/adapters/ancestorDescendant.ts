import type { RenderNode } from "../../render-model/render-ir/types.js";
import type { ParsedSelectorQuery, SelectorAnalysisTarget, SelectorQueryResult } from "../types.js";
import { buildSelectorQueryResult } from "../resultUtils.js";
import { attachMatchedReachability } from "../reachabilityResultUtils.js";
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
  analysisTargets: SelectorAnalysisTarget[];
}): SelectorQueryResult {
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;
  const matchedTargets: SelectorAnalysisTarget[] = [];

  for (const analysisTarget of input.analysisTargets) {
    const evaluation = inspectNodeForAncestorDescendantConstraint({
      node: analysisTarget.renderSubtree.root,
      ancestorClassName: input.constraint.ancestorClassName,
      subjectClassName: input.constraint.subjectClassName,
      ancestorStack: [],
    });

    if (evaluation === "match") {
      if (analysisTarget.reachabilityAvailability === "possible") {
        sawPossibleMatch = true;
        matchedTargets.push(analysisTarget);
        continue;
      }

      return attachMatchedReachability({
        selectorQuery: input.selectorQuery,
        matchedTargets: [analysisTarget],
        result: buildSelectorQueryResult({
          selectorQuery: input.selectorQuery,
          outcome: "match",
          status: "resolved",
          reasons: [
            `found a rendered descendant with class "${input.constraint.subjectClassName}" under an ancestor with class "${input.constraint.ancestorClassName}"`,
          ],
          certainty: "definite",
          dimensions: { structure: "definite" },
          traces: [
            {
              traceId: "selector-match:ancestor-descendant:definite",
              category: "selector-match",
              summary: `found a rendered descendant with class "${input.constraint.subjectClassName}" under an ancestor with class "${input.constraint.ancestorClassName}"`,
              anchor:
                input.selectorQuery.source.kind === "css-source"
                  ? input.selectorQuery.source.selectorAnchor
                  : undefined,
              children: [],
            },
          ],
        }),
      });
    }

    if (evaluation === "possible-match") {
      sawPossibleMatch = true;
      matchedTargets.push(analysisTarget);
    }

    if (evaluation === "unsupported") {
      sawUnsupportedDynamicClass = true;
    }
  }

  if (sawPossibleMatch) {
    return attachMatchedReachability({
      selectorQuery: input.selectorQuery,
      matchedTargets,
      result: buildSelectorQueryResult({
        selectorQuery: input.selectorQuery,
        outcome: "possible-match",
        status: "resolved",
        reasons: [
          `found a plausible ancestor-descendant match for "${input.constraint.ancestorClassName} ${input.constraint.subjectClassName}" on at least one bounded path`,
        ],
        certainty: "possible",
        dimensions: { structure: "possible" },
        traces: [
          {
            traceId: "selector-match:ancestor-descendant:possible",
            category: "selector-match",
            summary: `found a plausible ancestor-descendant match for "${input.constraint.ancestorClassName} ${input.constraint.subjectClassName}" on at least one bounded path`,
            anchor:
              input.selectorQuery.source.kind === "css-source"
                ? input.selectorQuery.source.selectorAnchor
                : undefined,
            children: [],
          },
        ],
      }),
    });
  }

  if (sawUnsupportedDynamicClass) {
    return buildSelectorQueryResult({
      selectorQuery: input.selectorQuery,
      outcome: "possible-match",
      status: "unsupported",
      reasons: [
        "encountered unsupported dynamic class construction while checking ancestor-descendant structure",
      ],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: [
        {
          traceId: "selector-match:ancestor-descendant:unsupported",
          category: "selector-match",
          summary:
            "encountered unsupported dynamic class construction while checking ancestor-descendant structure",
          anchor:
            input.selectorQuery.source.kind === "css-source"
              ? input.selectorQuery.source.selectorAnchor
              : undefined,
          children: [],
        },
      ],
    });
  }

  return buildSelectorQueryResult({
    selectorQuery: input.selectorQuery,
    outcome: "no-match-under-bounded-analysis",
    status: "resolved",
    reasons: [
      `no bounded rendered path satisfied ancestor "${input.constraint.ancestorClassName}" with descendant "${input.constraint.subjectClassName}"`,
    ],
    certainty: "definite",
    dimensions: { structure: "not-found-under-bounded-analysis" },
    traces: [
      {
        traceId: "selector-match:ancestor-descendant:no-match",
        category: "selector-match",
        summary: `no bounded rendered path satisfied ancestor "${input.constraint.ancestorClassName}" with descendant "${input.constraint.subjectClassName}"`,
        anchor:
          input.selectorQuery.source.kind === "css-source"
            ? input.selectorQuery.source.selectorAnchor
            : undefined,
        children: [],
      },
    ],
  });
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

  if (node.kind === "repeated-region") {
    const evaluation = inspectNodeForAncestorDescendantConstraint({
      ...input,
      node: node.template,
    });
    return evaluation === "match" ? "possible-match" : evaluation;
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
