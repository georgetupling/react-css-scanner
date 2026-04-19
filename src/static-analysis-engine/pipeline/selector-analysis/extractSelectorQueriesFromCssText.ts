import { extractParsedSelectorEntriesFromCssText } from "../selector-parsing/index.js";
import type { CssAtRuleContext, ExtractedSelectorQuery, SelectorSourceInput } from "./types.js";

export function extractSelectorQueriesFromCssText(
  input: SelectorSourceInput,
): ExtractedSelectorQuery[] {
  return extractParsedSelectorEntriesFromCssText(input).map((entry) => ({
    selectorText: entry.selectorText,
    source: {
      kind: "css-source",
      selectorAnchor: entry.selectorAnchor,
      ...(entry.atRuleContext
        ? {
            atRuleContext: entry.atRuleContext as CssAtRuleContext[],
          }
        : {}),
    },
  }));
}
