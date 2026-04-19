import type { ExtractedSelectorQuery, ParsedSelectorQuery } from "./types.js";
import {
  buildSelectorParseNotes,
  parseSelectorBranches,
  projectToNormalizedSelector,
  projectToSelectorConstraint,
} from "../selector-parsing/index.js";

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
          };
    const constraint = projectToSelectorConstraint(normalizedSelector);

    return {
      selectorText: selectorQuery.selectorText,
      source: selectorQuery.source,
      normalizedSelectorText,
      normalizedSelector,
      parseNotes: buildSelectorParseNotes(normalizedSelector),
      constraint,
    };
  });
}
