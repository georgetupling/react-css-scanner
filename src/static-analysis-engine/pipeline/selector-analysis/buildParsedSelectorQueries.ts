import type { ExtractedSelectorQuery, ParsedSelectorQuery } from "./types.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import {
  buildSelectorParseNotes,
  parseSelectorBranches,
  projectToNormalizedSelector,
  projectToSelectorConstraint,
} from "../../libraries/selector-parsing/index.js";

const UNSUPPORTED_SELECTOR_REASON =
  "only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported";

export function buildParsedSelectorQueries(
  selectorQueries: ExtractedSelectorQuery[],
): ParsedSelectorQuery[] {
  return selectorQueries.map((selectorQuery) => {
    const normalizedSelectorText = selectorQuery.selectorText.trim().replace(/\s+/g, " ");
    const parsedBranches = parseSelectorBranches(normalizedSelectorText);
    const normalizedSelector =
      parsedBranches.length === 1
        ? projectToNormalizedSelector(parsedBranches[0])
        : {
            kind: "unsupported" as const,
            reason: UNSUPPORTED_SELECTOR_REASON,
            traces: [
              {
                traceId: "selector-parsing:normalized-selector:multiple-branches",
                category: "selector-parsing" as const,
                summary:
                  "could not normalize selector because comma-separated or multi-branch selectors are not yet supported for bounded selector analysis",
                children: [],
                metadata: {
                  branchCount: parsedBranches.length,
                },
              },
            ],
          };
    const constraint = projectToSelectorConstraint(normalizedSelector);
    const parseTraces = collectSelectorParseTraces(normalizedSelector, constraint);

    return {
      selectorText: selectorQuery.selectorText,
      source: selectorQuery.source,
      normalizedSelectorText,
      normalizedSelector,
      parseNotes: buildSelectorParseNotes(normalizedSelector),
      parseTraces,
      constraint,
    };
  });
}

function collectSelectorParseTraces(
  normalizedSelector: ParsedSelectorQuery["normalizedSelector"],
  constraint: ParsedSelectorQuery["constraint"],
): AnalysisTrace[] {
  const tracesByKey = new Map<string, AnalysisTrace>();

  if (normalizedSelector.kind === "unsupported") {
    for (const trace of normalizedSelector.traces) {
      tracesByKey.set(serializeTrace(trace), trace);
    }
  }

  if ("kind" in constraint && constraint.kind === "unsupported") {
    for (const trace of constraint.traces) {
      tracesByKey.set(serializeTrace(trace), trace);
    }
  }

  return [...tracesByKey.values()];
}

function serializeTrace(trace: AnalysisTrace): string {
  return JSON.stringify({
    traceId: trace.traceId,
    category: trace.category,
    summary: trace.summary,
    metadata: trace.metadata ?? null,
    anchor: trace.anchor ?? null,
  });
}
