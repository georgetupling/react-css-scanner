import type {
  ParsedSelectorQuery,
  SelectorAnalysisTarget,
  SelectorRenderModelIndex,
  SelectorQueryResult,
} from "../types.js";
import { buildSelectorQueryResult } from "../resultUtils.js";
import { attachMatchedReachability } from "../reachabilityResultUtils.js";
import {
  evaluateElementClassRequirement,
  getScopedElements,
  mergeStructuralEvaluations,
  type StructuralEvaluation,
} from "./renderModelEvaluation.js";

type SameNodeConstraint = Extract<
  ParsedSelectorQuery["constraint"],
  { kind: "same-node-class-conjunction" }
>;

export function analyzeSameNodeClassConjunction(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: SameNodeConstraint;
  analysisTargets: SelectorAnalysisTarget[];
  renderModelIndex?: SelectorRenderModelIndex;
  includeTraces?: boolean;
}): SelectorQueryResult {
  const includeTraces = input.includeTraces ?? true;
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;
  const matchedTargets: SelectorAnalysisTarget[] = [];

  for (const analysisTarget of input.analysisTargets) {
    const evaluation = evaluateTargetAgainstEmissionSites({
      analysisTarget,
      classNames: input.constraint.classNames,
      renderModelIndex: input.renderModelIndex,
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
            `found a rendered element with all required classes: ${input.constraint.classNames.join(", ")}`,
          ],
          certainty: "definite",
          dimensions: { structure: "definite" },
          traces: includeTraces
            ? [
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
              ]
            : [],
          includeTraces,
        }),
        includeTraces,
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
        traces: includeTraces
          ? [
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
            ]
          : [],
        includeTraces,
      }),
      includeTraces,
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
      traces: includeTraces
        ? [
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
          ]
        : [],
      includeTraces,
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
    traces: includeTraces
      ? [
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
        ]
      : [],
    includeTraces,
  });
}

function evaluateTargetAgainstEmissionSites(input: {
  analysisTarget: SelectorAnalysisTarget;
  classNames: string[];
  renderModelIndex?: SelectorRenderModelIndex;
}): StructuralEvaluation {
  if (!input.renderModelIndex) {
    return "no-match";
  }

  return mergeStructuralEvaluations(
    getScopedElements(input.analysisTarget, input.renderModelIndex).map((element) =>
      evaluateElementClassRequirement({
        renderModelIndex: input.renderModelIndex as SelectorRenderModelIndex,
        elementId: element.id,
        classNames: input.classNames,
      }),
    ),
  );
}
