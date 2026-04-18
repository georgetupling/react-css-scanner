import type { RenderSubtree } from "../render-ir/types.js";
import type { ReachabilitySummary } from "../reachability/types.js";
import type { ParsedSelectorQuery, SelectorQueryResult } from "./types.js";
import { analyzeAncestorDescendantConstraint } from "./adapters/ancestorDescendant.js";
import { analyzeParentChildConstraint } from "./adapters/parentChild.js";
import { analyzeSameNodeClassConjunction } from "./adapters/sameNodeConjunction.js";
import { analyzeSiblingConstraint } from "./adapters/sibling.js";

export function analyzeSelectorQueries(input: {
  selectorQueries: ParsedSelectorQuery[];
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
}): SelectorQueryResult[] {
  return input.selectorQueries.map((selectorQuery) =>
    analyzeSelectorQuery({
      selectorQuery,
      renderSubtrees: input.renderSubtrees,
      reachabilitySummary: input.reachabilitySummary,
    }),
  );
}

function analyzeSelectorQuery(input: {
  selectorQuery: ParsedSelectorQuery;
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
}): SelectorQueryResult {
  const { constraint } = input.selectorQuery;
  if (input.selectorQuery.source.kind === "css-source") {
    const reachabilityResolution = resolveQueryReachability(input);
    if (reachabilityResolution.result) {
      return reachabilityResolution.result;
    }

    input = {
      ...input,
      renderSubtrees: reachabilityResolution.renderSubtrees,
    };
  }

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

function resolveQueryReachability(input: {
  selectorQuery: ParsedSelectorQuery;
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
}):
  | {
      result: SelectorQueryResult;
      renderSubtrees: RenderSubtree[];
    }
  | {
      result?: undefined;
      renderSubtrees: RenderSubtree[];
    } {
  if (input.selectorQuery.source.kind !== "css-source") {
    return {
      renderSubtrees: input.renderSubtrees,
    };
  }

  const cssFilePath = input.selectorQuery.source.selectorAnchor?.filePath;
  const reachabilityRecord = input.reachabilitySummary?.stylesheets.find(
    (stylesheet) => stylesheet.cssFilePath === cssFilePath,
  );

  if (!reachabilityRecord) {
    return {
      result: {
        selectorText: input.selectorQuery.selectorText,
        source: input.selectorQuery.source,
        constraint: input.selectorQuery.constraint,
        outcome: "possible-match",
        status: "unsupported",
        confidence: "low",
        reasons: ["could not determine stylesheet reachability for this selector source"],
        reachability: {
          kind: "css-source",
          cssFilePath,
          availability: "unknown",
          directlyImportingSourceFilePaths: [],
          reasons: ["no reachability record exists for this stylesheet source"],
        },
      },
      renderSubtrees: [],
    };
  }

  if (reachabilityRecord.availability === "unknown") {
    return {
      result: {
        selectorText: input.selectorQuery.selectorText,
        source: input.selectorQuery.source,
        constraint: input.selectorQuery.constraint,
        outcome: "possible-match",
        status: "unsupported",
        confidence: "low",
        reasons: ["stylesheet reachability is unknown for this selector source"],
        reachability: {
          kind: "css-source",
          cssFilePath: reachabilityRecord.cssFilePath,
          availability: reachabilityRecord.availability,
          directlyImportingSourceFilePaths: reachabilityRecord.directlyImportingSourceFilePaths,
          reasons: reachabilityRecord.reasons,
        },
      },
      renderSubtrees: [],
    };
  }

  if (reachabilityRecord.availability === "unavailable") {
    return {
      result: {
        selectorText: input.selectorQuery.selectorText,
        source: input.selectorQuery.source,
        constraint: input.selectorQuery.constraint,
        outcome: "no-match-under-bounded-analysis",
        status: "resolved",
        confidence: "high",
        reasons: [
          "stylesheet is not reachable from any analyzed source file under direct-import reachability",
        ],
        reachability: {
          kind: "css-source",
          cssFilePath: reachabilityRecord.cssFilePath,
          availability: reachabilityRecord.availability,
          directlyImportingSourceFilePaths: reachabilityRecord.directlyImportingSourceFilePaths,
          reasons: reachabilityRecord.reasons,
        },
      },
      renderSubtrees: [],
    };
  }

  const reachableSourceFiles = new Set(reachabilityRecord.directlyImportingSourceFilePaths);
  return {
    renderSubtrees: input.renderSubtrees.filter((subtree) =>
      reachableSourceFiles.has(subtree.sourceAnchor.filePath.replace(/\\/g, "/")),
    ),
  };
}
