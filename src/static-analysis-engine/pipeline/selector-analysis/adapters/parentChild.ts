import type { RenderNode } from "../../render-model/render-ir/types.js";
import type { ParsedSelectorQuery, SelectorAnalysisTarget, SelectorQueryResult } from "../types.js";
import { buildSelectorQueryResult } from "../resultUtils.js";
import type { RenderNodeInspectionAdapter } from "../renderInspection.js";
import { inspectRenderNode } from "../renderInspection.js";
import { attachMatchedReachability } from "../reachabilityResultUtils.js";
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
  analysisTargets: SelectorAnalysisTarget[];
}): SelectorQueryResult {
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;
  const matchedTargets: SelectorAnalysisTarget[] = [];

  for (const analysisTarget of input.analysisTargets) {
    const evaluation = inspectRenderNode({
      node: analysisTarget.renderSubtree.root,
      state: {
        parentClassName: input.constraint.parentClassName,
        childClassName: input.constraint.childClassName,
      },
      adapter: parentChildConstraintAdapter,
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
          traces: [
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
          `found a plausible direct parent-child match for "${input.constraint.parentClassName} > ${input.constraint.childClassName}" on at least one bounded path`,
        ],
        certainty: "possible",
        dimensions: { structure: "possible" },
        traces: [
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
        "encountered unsupported dynamic class construction while checking direct parent-child structure",
      ],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: [
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
      ],
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
    traces: [
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
    ],
  });
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

  if (node.kind === "repeated-region") {
    const evaluation = inspectDirectChildForClassRequirement(
      node.template,
      childClassName,
      parentPresence,
    );
    return evaluation === "match" ? "possible-match" : evaluation;
  }

  if (node.kind !== "element") {
    return "no-match";
  }

  return combinePresence(
    parentPresence,
    evaluateSingleClassPresence(node.className, childClassName),
  );
}
