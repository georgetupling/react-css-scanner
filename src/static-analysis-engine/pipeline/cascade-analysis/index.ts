export { buildCascadeAnalysis } from "./buildCascadeAnalysis.js";
export {
  cascadeConditionSetId,
  cascadeDeclarationCandidateId,
  cascadeDiagnosticId,
  cascadeOutcomeId,
  elementPropertyKey,
} from "./ids.js";
export { calculateSelectorSpecificity, compareSpecificity } from "./specificity.js";
export type { CascadeAnalysisInput } from "./buildCascadeAnalysis.js";
export type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisDiagnosticCode,
  CascadeAnalysisIndexes,
  CascadeAnalysisMeta,
  CascadeAnalysisResult,
  CascadeComparisonReason,
  CascadeComparisonStep,
  CascadeConditionSet,
  CascadeConditionSource,
  CascadeDeclarationCandidate,
  CascadeKey,
  CascadeOutcome,
  CssDeclarationCascadeRecord,
  CssSpecificity,
} from "./types.js";
