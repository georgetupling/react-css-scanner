export { buildOwnershipInference } from "./buildOwnershipInference.js";
export type {
  OwnershipInferenceCompatibilityInput,
  OwnershipInferenceInput,
  OwnershipInferenceOptions,
} from "./buildOwnershipInference.js";
export {
  classOwnershipAnalysisFromOwnershipInference,
  ownershipEvidenceFromClassOwnershipAnalysis,
} from "./projectAnalysisAdapter.js";
export {
  classDefinitionConsumerEvidenceId,
  classOwnershipEvidenceId,
  ownershipInferenceDiagnosticId,
  styleClassificationEvidenceId,
  styleOwnerCandidateId,
  stylesheetOwnershipEvidenceId,
} from "./ids.js";
export type {
  ClassConsumerSummary,
  ClassDefinitionConsumerEvidence,
  ClassOwnershipEvidence,
  OwnershipCandidateId,
  OwnershipCandidateOwnerKind,
  OwnershipCandidateReason,
  OwnershipCandidateTargetKind,
  OwnershipClassification,
  OwnershipClassificationId,
  OwnershipClassificationTargetKind,
  OwnershipConsumptionKind,
  OwnershipConsumerAvailability,
  OwnershipDiagnosticTargetKind,
  OwnershipEvidenceId,
  OwnershipEvidenceKind,
  OwnershipInferenceDiagnostic,
  OwnershipInferenceDiagnosticCode,
  OwnershipInferenceDiagnosticId,
  OwnershipInferenceIndexes,
  OwnershipInferenceMeta,
  OwnershipInferenceResult,
  StyleClassificationEvidence,
  StyleOwnerCandidate,
  StylesheetOwnershipBroadness,
  StylesheetOwnershipEvidence,
} from "./types.js";
