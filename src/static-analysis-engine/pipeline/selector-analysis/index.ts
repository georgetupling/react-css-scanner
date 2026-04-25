export { extractSelectorQueriesFromCssText } from "./extractSelectorQueriesFromCssText.js";
export { buildSelectorQueries } from "./buildSelectorQueries.js";
export { buildParsedSelectorQueries } from "./buildParsedSelectorQueries.js";
export { analyzeSelectorQueries } from "./analyzeSelectorQueries.js";
export { buildSelectorQueryResult } from "./resultUtils.js";
export type {
  AnalysisConfidence,
  AnalysisStatus,
  ExtractedSelectorQuery,
  NormalizedSelector,
  NormalizedSelectorCombinator,
  NormalizedSelectorSimpleSelector,
  NormalizedSelectorStep,
  ParsedSelectorQuery,
  SelectorConstraint,
  SelectorQueryResult,
  SelectorSourceInput,
  SemanticOutcome,
} from "./types.js";
