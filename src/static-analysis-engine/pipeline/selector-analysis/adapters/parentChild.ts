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

type ParentChildConstraint = Extract<ParsedSelectorQuery["constraint"], { kind: "parent-child" }>;

export function analyzeParentChildConstraint(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: ParentChildConstraint;
  analysisTargets: SelectorAnalysisTarget[];
  renderModelIndex?: SelectorRenderModelIndex;
  includeTraces?: boolean;
}): SelectorQueryResult {
  const includeTraces = input.includeTraces ?? true;
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;
  const matchedTargets: SelectorAnalysisTarget[] = [];

  for (const analysisTarget of input.analysisTargets) {
    const evaluation = evaluateParentChildFromRenderModel({
      analysisTarget,
      parentClassName: input.constraint.parentClassName,
      childClassName: input.constraint.childClassName,
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
            `found a rendered child with class "${input.constraint.childClassName}" directly under a parent with class "${input.constraint.parentClassName}"`,
          ],
          certainty: "definite",
          dimensions: { structure: "definite" },
          traces: includeTraces
            ? [
                {
                  traceId: "selector-match:parent-child:definite",
                  category: "selector-match",
                  summary: `found a rendered child with class "${input.constraint.childClassName}" directly under a parent with class "${input.constraint.parentClassName}"`,
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
          `found a plausible direct parent-child match for "${input.constraint.parentClassName} > ${input.constraint.childClassName}" on at least one bounded path`,
        ],
        certainty: "possible",
        dimensions: { structure: "possible" },
        traces: includeTraces
          ? [
              {
                traceId: "selector-match:parent-child:possible",
                category: "selector-match",
                summary: `found a plausible direct parent-child match for "${input.constraint.parentClassName} > ${input.constraint.childClassName}" on at least one bounded path`,
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
        "encountered unsupported dynamic class construction while checking direct parent-child structure",
      ],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: includeTraces
        ? [
            {
              traceId: "selector-match:parent-child:unsupported",
              category: "selector-match",
              summary:
                "encountered unsupported dynamic class construction while checking direct parent-child structure",
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
      `no bounded rendered path satisfied parent "${input.constraint.parentClassName}" with direct child "${input.constraint.childClassName}"`,
    ],
    certainty: "definite",
    dimensions: { structure: "not-found-under-bounded-analysis" },
    traces: includeTraces
      ? [
          {
            traceId: "selector-match:parent-child:no-match",
            category: "selector-match",
            summary: `no bounded rendered path satisfied parent "${input.constraint.parentClassName}" with direct child "${input.constraint.childClassName}"`,
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

function evaluateParentChildFromRenderModel(input: {
  analysisTarget: SelectorAnalysisTarget;
  parentClassName: string;
  childClassName: string;
  renderModelIndex?: SelectorRenderModelIndex;
}): StructuralEvaluation {
  if (!input.renderModelIndex) {
    return "no-match";
  }

  const scopedElements = getScopedElements(input.analysisTarget, input.renderModelIndex);
  const scopedElementIds = new Set(scopedElements.map((element) => element.id));
  let sawPossible = false;
  let sawUnsupported = false;

  for (const childElement of scopedElements) {
    const parentId = childElement.parentElementId;
    if (!parentId || !scopedElementIds.has(parentId)) {
      continue;
    }
    const parentPresence = evaluateElementPresence(
      input.renderModelIndex,
      parentId,
      input.parentClassName,
    );
    if (parentPresence === "no-match") {
      continue;
    }
    const childPresence = evaluateElementPresence(
      input.renderModelIndex,
      childElement.id,
      input.childClassName,
    );
    const combined =
      childPresence === "no-match" ? "no-match" : combinePresence(parentPresence, childPresence);
    if (combined === "match") {
      return "match";
    }
    if (combined === "possible-match") {
      sawPossible = true;
    }
    if (combined === "unsupported" || childPresence === "unsupported") {
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
