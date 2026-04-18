import type { RenderSubtree } from "../render-ir/types.js";
import type { ParsedSelectorQuery, SelectorQueryResult } from "./types.js";
import { analyzeAncestorDescendantConstraint } from "./adapters/ancestorDescendant.js";
import { analyzeParentChildConstraint } from "./adapters/parentChild.js";
import { analyzeSameNodeClassConjunction } from "./adapters/sameNodeConjunction.js";
import { analyzeSiblingConstraint } from "./adapters/sibling.js";

export function analyzeSelectorQueries(input: {
  selectorQueries: ParsedSelectorQuery[];
  renderSubtrees: RenderSubtree[];
}): SelectorQueryResult[] {
  return input.selectorQueries.map((selectorQuery) =>
    analyzeSelectorQuery({
      selectorQuery,
      renderSubtrees: input.renderSubtrees,
    }),
  );
}

function analyzeSelectorQuery(input: {
  selectorQuery: ParsedSelectorQuery;
  renderSubtrees: RenderSubtree[];
}): SelectorQueryResult {
  const { constraint } = input.selectorQuery;
  if ("kind" in constraint && constraint.kind === "unsupported") {
    return {
      selectorText: input.selectorQuery.selectorText,
      source: input.selectorQuery.source,
      constraint,
      outcome: "possible-match",
      status: "unsupported",
      confidence: "low",
      reasons: [
        `unsupported selector query: ${constraint.reason}`,
        ...input.selectorQuery.parseNotes,
      ],
    };
  }

  if (constraint.kind === "same-node-class-conjunction") {
    return analyzeSameNodeClassConjunction({
      selectorQuery: input.selectorQuery,
      constraint,
      renderSubtrees: input.renderSubtrees,
    });
  }

  if (constraint.kind === "parent-child") {
    return analyzeParentChildConstraint({
      selectorQuery: input.selectorQuery,
      constraint,
      renderSubtrees: input.renderSubtrees,
    });
  }

  if (constraint.kind === "sibling") {
    return analyzeSiblingConstraint({
      selectorQuery: input.selectorQuery,
      constraint,
      renderSubtrees: input.renderSubtrees,
    });
  }

  return analyzeAncestorDescendantConstraint({
    selectorQuery: input.selectorQuery,
    constraint,
    renderSubtrees: input.renderSubtrees,
  });
}
