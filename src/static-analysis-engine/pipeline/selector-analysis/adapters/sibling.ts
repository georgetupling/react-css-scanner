import type {
  ParsedSelectorQuery,
  SelectorAnalysisTarget,
  SelectorQueryResult,
  SelectorRenderModelIndex,
} from "../types.js";
import { buildSelectorQueryResult } from "../resultUtils.js";
import { attachMatchedReachability } from "../reachabilityResultUtils.js";
import { combinePresence } from "../selectorEvaluationUtils.js";
import {
  evaluateElementPresence,
  getScopedElements,
  type StructuralEvaluation,
} from "./renderModelEvaluation.js";

type SiblingConstraint = Extract<ParsedSelectorQuery["constraint"], { kind: "sibling" }>;

export function analyzeSiblingConstraint(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: SiblingConstraint;
  analysisTargets: SelectorAnalysisTarget[];
  renderModelIndex?: SelectorRenderModelIndex;
  includeTraces?: boolean;
}): SelectorQueryResult {
  const includeTraces = input.includeTraces ?? true;
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;
  const matchedTargets: SelectorAnalysisTarget[] = [];

  for (const analysisTarget of input.analysisTargets) {
    const evaluation = evaluateSiblingFromRenderModel({
      analysisTarget,
      constraint: input.constraint,
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
            `found a rendered ${describeRelation(input.constraint.relation)} sibling with class "${input.constraint.rightClassName}" after a sibling with class "${input.constraint.leftClassName}"`,
          ],
          certainty: "definite",
          dimensions: { structure: "definite" },
          traces: includeTraces
            ? [
                {
                  traceId: `selector-match:sibling:${input.constraint.relation}:definite`,
                  category: "selector-match",
                  summary: `found a rendered ${describeRelation(input.constraint.relation)} sibling with class "${input.constraint.rightClassName}" after a sibling with class "${input.constraint.leftClassName}"`,
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
          `found a plausible ${describeRelation(input.constraint.relation)} sibling match for "${input.constraint.leftClassName}${input.constraint.relation === "adjacent" ? " + " : " ~ "}${input.constraint.rightClassName}" on at least one bounded path`,
        ],
        certainty: "possible",
        dimensions: { structure: "possible" },
        traces: includeTraces
          ? [
              {
                traceId: `selector-match:sibling:${input.constraint.relation}:possible`,
                category: "selector-match",
                summary: `found a plausible ${describeRelation(input.constraint.relation)} sibling match for "${input.constraint.leftClassName}${input.constraint.relation === "adjacent" ? " + " : " ~ "}${input.constraint.rightClassName}" on at least one bounded path`,
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
        `encountered unsupported dynamic class construction while checking ${describeRelation(input.constraint.relation)} sibling structure`,
      ],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: includeTraces
        ? [
            {
              traceId: `selector-match:sibling:${input.constraint.relation}:unsupported`,
              category: "selector-match",
              summary: `encountered unsupported dynamic class construction while checking ${describeRelation(input.constraint.relation)} sibling structure`,
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
      `no bounded rendered path satisfied ${describeRelation(input.constraint.relation)} sibling "${input.constraint.leftClassName}" with sibling "${input.constraint.rightClassName}"`,
    ],
    certainty: "definite",
    dimensions: { structure: "not-found-under-bounded-analysis" },
    traces: includeTraces
      ? [
          {
            traceId: `selector-match:sibling:${input.constraint.relation}:no-match`,
            category: "selector-match",
            summary: `no bounded rendered path satisfied ${describeRelation(input.constraint.relation)} sibling "${input.constraint.leftClassName}" with sibling "${input.constraint.rightClassName}"`,
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

function evaluateSiblingFromRenderModel(input: {
  analysisTarget: SelectorAnalysisTarget;
  constraint: SiblingConstraint;
  renderModelIndex?: SelectorRenderModelIndex;
}): StructuralEvaluation {
  if (!input.renderModelIndex) {
    return "no-match";
  }

  const scopedElements = getScopedElements(input.analysisTarget, input.renderModelIndex);
  const byId = new Map(scopedElements.map((element) => [element.id, element]));
  let sawPossible = false;
  let sawUnsupported = false;

  for (const left of scopedElements) {
    const siblingIds =
      input.renderModelIndex.renderModel.indexes.siblingElementIdsByElementId.get(left.id) ?? [];
    for (const siblingId of siblingIds) {
      const right = byId.get(siblingId);
      if (!right) {
        continue;
      }

      if (
        !isOrderedSiblingMatch(input.renderModelIndex, left.id, right.id, input.constraint.relation)
      ) {
        continue;
      }

      const leftPresence = evaluateElementPresence(
        input.renderModelIndex,
        left.id,
        input.constraint.leftClassName,
      );
      if (leftPresence === "no-match") {
        continue;
      }
      const rightPresence = evaluateElementPresence(
        input.renderModelIndex,
        right.id,
        input.constraint.rightClassName,
      );
      const combined =
        rightPresence === "no-match" ? "no-match" : combinePresence(leftPresence, rightPresence);
      if (combined === "match") {
        return "match";
      }
      if (combined === "possible-match") {
        sawPossible = true;
      }
      if (combined === "unsupported" || rightPresence === "unsupported") {
        sawUnsupported = true;
      }
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

function isOrderedSiblingMatch(
  renderModelIndex: SelectorRenderModelIndex,
  leftElementId: string,
  rightElementId: string,
  relation: SiblingConstraint["relation"],
): boolean {
  const leftIndex = readChildIndex(renderModelIndex, leftElementId);
  const rightIndex = readChildIndex(renderModelIndex, rightElementId);
  if (leftIndex === undefined || rightIndex === undefined) {
    return false;
  }
  return relation === "adjacent" ? rightIndex === leftIndex + 1 : rightIndex > leftIndex;
}

function readChildIndex(
  renderModelIndex: SelectorRenderModelIndex,
  elementId: string,
): number | undefined {
  const element = renderModelIndex.renderModel.indexes.elementById.get(elementId);
  if (!element) {
    return undefined;
  }
  const path = renderModelIndex.renderModel.indexes.renderPathById.get(element.renderPathId);
  if (!path) {
    return undefined;
  }

  for (let i = path.segments.length - 1; i >= 0; i -= 1) {
    const segment = path.segments[i];
    if (segment.kind === "child-index") {
      return segment.index;
    }
    if (segment.kind === "element") {
      continue;
    }
  }
  return undefined;
}

function describeRelation(relation: SiblingConstraint["relation"]): string {
  return relation === "adjacent" ? "adjacent" : "general";
}
