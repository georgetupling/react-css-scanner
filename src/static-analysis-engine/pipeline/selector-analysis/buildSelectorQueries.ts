import { extractSelectorQueriesFromCssText } from "./extractSelectorQueriesFromCssText.js";
import type { ExtractedSelectorQuery, SelectorSourceInput } from "./types.js";

export function buildSelectorQueries(input: {
  selectorQueries: string[];
  selectorCssSources: SelectorSourceInput[];
}): ExtractedSelectorQuery[] {
  const directQueries: ExtractedSelectorQuery[] = input.selectorQueries.map((selectorText) => ({
    selectorText,
    source: { kind: "direct-query" },
  }));
  const cssDerivedQueries = input.selectorCssSources.flatMap((selectorSource) =>
    extractSelectorQueriesFromCssText(selectorSource),
  );

  return [...directQueries, ...cssDerivedQueries];
}
