export { evaluateSymbolicExpressions } from "./entry/evaluateSymbolicExpressions.js";
export {
  buildClassExpressionTraces,
  combineStrings,
  mergeClassNameValues,
  toAbstractClassSet,
  tokenizeClassNames,
  uniqueSorted,
} from "./values/index.js";
export { toClassExpressionSummary } from "./canonical/classExpressionSummary.js";
export {
  canonicalClassExpressionId,
  classEmissionVariantId,
  conditionId,
  cssModuleContributionId,
  externalContributionId,
  tokenAlternativeId,
  unsupportedReasonId,
} from "./model/ids.js";
export { buildEvaluatedExpressionIndexes } from "./model/indexes.js";
export {
  createDefaultSymbolicEvaluatorRegistry,
  createSymbolicEvaluatorRegistry,
  fallbackClassExpressionEvaluator,
  normalizedClassExpressionEvaluator,
  runtimeDomClassExpressionEvaluator,
} from "./entry/registry.js";
export { createSymbolicEvaluationTrace, traceList } from "./model/traces.js";
export {
  duplicateEvaluatedExpressionIdDiagnostic,
  missingExpressionSyntaxDiagnostic,
  sortSymbolicEvaluationDiagnostics,
  symbolicEvaluationProvenance,
  unresolvedClassExpressionSiteDiagnostic,
} from "./model/diagnostics.js";
export type {
  AbstractClassSet,
  AbstractValue,
  ClassDerivationStep,
  ClassExpressionSummary,
} from "./values/index.js";
export type {
  CanonicalClassExpression,
  CanonicalExpressionKind,
  Certainty,
  ClassEmissionVariant,
  ConditionFact,
  ConditionId,
  CssModuleClassContribution,
  EvaluatedExpressionFacts,
  EvaluatedExpressionId,
  EvaluatedExpressionIndexes,
  ExternalClassContribution,
  SymbolicEvaluationDiagnostic,
  SymbolicEvaluationInput,
  SymbolicEvaluationOptions,
  SymbolicEvaluationProvenance,
  SymbolicEvaluationResult,
  SymbolicEvaluatorRegistry,
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
  SymbolicExpressionEvaluatorResult,
  TokenAlternative,
  UnsupportedReason,
  UnsupportedReasonCode,
} from "./model/types.js";
