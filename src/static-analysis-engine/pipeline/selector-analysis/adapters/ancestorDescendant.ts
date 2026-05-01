import type {
  ParsedSelectorQuery,
  SelectorAnalysisTarget,
  SelectorQueryResult,
  SelectorReachabilityEvidence,
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
import { evaluateSelectorReachabilityEvidence } from "./selectorReachabilityEvaluation.js";

type AncestorDescendantConstraint = Extract<
  ParsedSelectorQuery["constraint"],
  { kind: "ancestor-descendant" }
>;

export function analyzeAncestorDescendantConstraint(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: AncestorDescendantConstraint;
  analysisTargets: SelectorAnalysisTarget[];
  renderModelIndex?: SelectorRenderModelIndex;
  selectorReachability?: SelectorReachabilityEvidence;
  includeTraces?: boolean;
}): SelectorQueryResult {
  const includeTraces = input.includeTraces ?? true;
  const stageEvaluation = evaluateAncestorDescendantReachability(input);
  if (stageEvaluation) {
    return stageEvaluation;
  }

  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;
  const matchedTargets: SelectorAnalysisTarget[] = [];

  for (const analysisTarget of input.analysisTargets) {
    const evaluation = evaluateAncestorDescendantFromRenderModel({
      analysisTarget,
      ancestorClassName: input.constraint.ancestorClassName,
      subjectClassName: input.constraint.subjectClassName,
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
            `found a rendered descendant with class "${input.constraint.subjectClassName}" under an ancestor with class "${input.constraint.ancestorClassName}"`,
          ],
          certainty: "definite",
          dimensions: { structure: "definite" },
          traces: includeTraces
            ? [
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
          `found a plausible ancestor-descendant match for "${input.constraint.ancestorClassName} ${input.constraint.subjectClassName}" on at least one bounded path`,
        ],
        certainty: "possible",
        dimensions: { structure: "possible" },
        traces: includeTraces
          ? [
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
        "encountered unsupported dynamic class construction while checking ancestor-descendant structure",
      ],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: includeTraces
        ? [
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
      `no bounded rendered path satisfied ancestor "${input.constraint.ancestorClassName}" with descendant "${input.constraint.subjectClassName}"`,
    ],
    certainty: "definite",
    dimensions: { structure: "not-found-under-bounded-analysis" },
    traces: includeTraces
      ? [
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
        ]
      : [],
    includeTraces,
  });
}

function evaluateAncestorDescendantReachability(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: AncestorDescendantConstraint;
  analysisTargets: SelectorAnalysisTarget[];
  selectorReachability?: SelectorReachabilityEvidence;
  includeTraces?: boolean;
}): SelectorQueryResult | undefined {
  const evaluation = evaluateSelectorReachabilityEvidence(input);
  if (!evaluation) {
    return undefined;
  }

  const includeTraces = input.includeTraces ?? true;
  const anchor =
    input.selectorQuery.source.kind === "css-source"
      ? input.selectorQuery.source.selectorAnchor
      : undefined;
  if (evaluation.hasDefiniteMatch) {
    return attachMatchedReachability({
      selectorQuery: input.selectorQuery,
      matchedTargets: evaluation.matchedTargets,
      result: buildSelectorQueryResult({
        selectorQuery: input.selectorQuery,
        outcome: "match",
        status: "resolved",
        reasons: [
          `found a rendered descendant with class "${input.constraint.subjectClassName}" under an ancestor with class "${input.constraint.ancestorClassName}"`,
        ],
        certainty: "definite",
        dimensions: { structure: "definite" },
        traces: includeTraces
          ? [
              {
                traceId: "selector-reachability:ancestor-descendant:definite",
                category: "selector-match",
                summary: `Stage 6 found a rendered descendant with class "${input.constraint.subjectClassName}" under an ancestor with class "${input.constraint.ancestorClassName}"`,
                anchor,
                children: [],
                metadata: {
                  selectorBranchNodeId: evaluation.branch.selectorBranchNodeId,
                },
              },
            ]
          : [],
        includeTraces,
      }),
      includeTraces,
    });
  }

  if (evaluation.hasPossibleMatch) {
    return attachMatchedReachability({
      selectorQuery: input.selectorQuery,
      matchedTargets: evaluation.matchedTargets,
      result: buildSelectorQueryResult({
        selectorQuery: input.selectorQuery,
        outcome: "possible-match",
        status: "resolved",
        reasons: [
          `found a plausible ancestor-descendant match for "${input.constraint.ancestorClassName} ${input.constraint.subjectClassName}" on at least one bounded path`,
        ],
        certainty: "possible",
        dimensions: { structure: "possible" },
        traces: includeTraces
          ? [
              {
                traceId: "selector-reachability:ancestor-descendant:possible",
                category: "selector-match",
                summary: `Stage 6 found a plausible ancestor-descendant match for "${input.constraint.ancestorClassName} ${input.constraint.subjectClassName}"`,
                anchor,
                children: [],
                metadata: {
                  selectorBranchNodeId: evaluation.branch.selectorBranchNodeId,
                },
              },
            ]
          : [],
        includeTraces,
      }),
      includeTraces,
    });
  }

  if (evaluation.hasUnknownContextMatch) {
    return buildSelectorQueryResult({
      selectorQuery: input.selectorQuery,
      outcome: "possible-match",
      status: "unsupported",
      reasons: [
        "encountered unsupported dynamic class construction while checking ancestor-descendant structure",
      ],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: includeTraces
        ? [
            {
              traceId: "selector-reachability:ancestor-descendant:unsupported",
              category: "selector-match",
              summary:
                "Stage 6 found this ancestor-descendant selector can only match through unknown class context",
              anchor,
              children: [],
              metadata: {
                selectorBranchNodeId: evaluation.branch.selectorBranchNodeId,
              },
            },
          ]
        : [],
      includeTraces,
    });
  }

  if (evaluation.branch.status === "unsupported") {
    return buildSelectorQueryResult({
      selectorQuery: input.selectorQuery,
      outcome: "possible-match",
      status: "unsupported",
      reasons: ["selector branch contains unsupported selector semantics"],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: [],
      includeTraces,
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
    traces: includeTraces
      ? [
          {
            traceId: "selector-reachability:ancestor-descendant:no-match",
            category: "selector-match",
            summary: `Stage 6 found no bounded rendered path satisfying ancestor "${input.constraint.ancestorClassName}" with descendant "${input.constraint.subjectClassName}"`,
            anchor,
            children: [],
            metadata: {
              selectorBranchNodeId: evaluation.branch.selectorBranchNodeId,
            },
          },
        ]
      : [],
    includeTraces,
  });
}

function evaluateAncestorDescendantFromRenderModel(input: {
  analysisTarget: SelectorAnalysisTarget;
  ancestorClassName: string;
  subjectClassName: string;
  renderModelIndex?: SelectorRenderModelIndex;
}): StructuralEvaluation {
  if (!input.renderModelIndex) {
    return "no-match";
  }

  const scopedElements = getScopedElements(input.analysisTarget, input.renderModelIndex);
  let sawPossible = false;
  let sawUnsupported = false;

  for (const subjectElement of scopedElements) {
    const subjectPresence = evaluateElementPresence(
      input.renderModelIndex,
      subjectElement.id,
      input.subjectClassName,
    );
    if (subjectPresence === "no-match") {
      continue;
    }

    const ancestorIds =
      input.renderModelIndex.renderModel.indexes.ancestorElementIdsByElementId.get(
        subjectElement.id,
      ) ?? [];
    for (const ancestorId of ancestorIds) {
      const ancestorPresence = evaluateElementPresence(
        input.renderModelIndex,
        ancestorId,
        input.ancestorClassName,
      );
      const combined =
        ancestorPresence === "no-match"
          ? "no-match"
          : combinePresence(ancestorPresence, subjectPresence);
      if (combined === "match") {
        return "match";
      }
      if (combined === "possible-match") {
        sawPossible = true;
      }
      if (combined === "unsupported" || subjectPresence === "unsupported") {
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
