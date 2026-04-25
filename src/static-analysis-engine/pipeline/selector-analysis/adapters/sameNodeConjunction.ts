import type { RenderNode } from "../../render-model/render-ir/types.js";
import type { ParsedSelectorQuery, SelectorAnalysisTarget, SelectorQueryResult } from "../types.js";
import { buildSelectorQueryResult } from "../resultUtils.js";
import { mergeBranchEvaluations, mergeInspectionEvaluations } from "../renderInspection.js";
import { attachMatchedReachability } from "../reachabilityResultUtils.js";
import { evaluateClassRequirement } from "../selectorEvaluationUtils.js";

type SameNodeConstraint = Extract<
  ParsedSelectorQuery["constraint"],
  { kind: "same-node-class-conjunction" }
>;

export function analyzeSameNodeClassConjunction(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: SameNodeConstraint;
  analysisTargets: SelectorAnalysisTarget[];
}): SelectorQueryResult {
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;
  const matchedTargets: SelectorAnalysisTarget[] = [];

  for (const analysisTarget of input.analysisTargets) {
    const evaluation = inspectNodeForSameNodeConstraint(
      analysisTarget.renderSubtree.root,
      input.constraint.classNames,
    );
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
            `found a rendered element with all required classes: ${input.constraint.classNames.join(", ")}`,
          ],
          certainty: "definite",
          dimensions: { structure: "definite" },
          traces: [
            {
              traceId: "selector-match:same-node:definite",
              category: "selector-match",
              summary: `found a rendered element with all required classes: ${input.constraint.classNames.join(", ")}`,
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
          `at least one rendered element may emit all required classes together: ${input.constraint.classNames.join(", ")}`,
        ],
        certainty: "possible",
        dimensions: { structure: "possible" },
        traces: [
          {
            traceId: "selector-match:same-node:possible",
            category: "selector-match",
            summary: `at least one rendered element may emit all required classes together: ${input.constraint.classNames.join(", ")}`,
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
        "encountered unsupported dynamic class construction while checking same-node class conjunction",
      ],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: [
        {
          traceId: "selector-match:same-node:unsupported",
          category: "selector-match",
          summary:
            "encountered unsupported dynamic class construction while checking same-node class conjunction",
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
      `no rendered element emitted all required classes together: ${input.constraint.classNames.join(", ")}`,
    ],
    certainty: "definite",
    dimensions: { structure: "not-found-under-bounded-analysis" },
    traces: [
      {
        traceId: "selector-match:same-node:no-match",
        category: "selector-match",
        summary: `no rendered element emitted all required classes together: ${input.constraint.classNames.join(", ")}`,
        anchor:
          input.selectorQuery.source.kind === "css-source"
            ? input.selectorQuery.source.selectorAnchor
            : undefined,
        children: [],
      },
    ],
  });
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

  if (node.kind === "repeated-region") {
    const evaluation = inspectNodeForSameNodeConstraint(node.template, classNames);
    return evaluation === "match" ? "possible-match" : evaluation;
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
