export { extractParsedSelectorEntriesFromCssText } from "./extractParsedSelectorEntriesFromCssText.js";
export { extractParsedSelectorEntriesFromSelectorPrelude } from "./extractParsedSelectorEntriesFromSelectorPrelude.js";
export { extractSelectorBranchFacts } from "./extractSelectorBranchFacts.js";
export { parseSelectorBranch } from "./parseSelectorBranch.js";
export { parseSelectorBranches } from "./parseSelectorBranches.js";
export { projectToCssSelectorBranchFact } from "./projectToCssSelectorBranchFact.js";
export {
  buildSelectorParseNotes,
  projectToNormalizedSelector,
  projectToSelectorConstraint,
} from "./projectToSelectorAnalysis.js";
export type {
  CssAtRuleContext,
  CssSelectorBranchSource,
  ExtractedSelectorQuery,
  NormalizedSelector,
  NormalizedSelectorCombinator,
  NormalizedSelectorSimpleSelector,
  NormalizedSelectorStep,
  SelectorConstraint,
  SelectorSourceInput,
} from "./queryTypes.js";
export type {
  ParsedCssAtRuleContext,
  ParsedClassAttributePredicate,
  ParsedCssSelectorEntry,
  ParsedSelectorBranch,
  ParsedSelectorBranchMatchKind,
  ParsedSelectorStep,
  ParsedSimpleSelectorSequence,
  SelectorStepCombinator,
} from "./types.js";
