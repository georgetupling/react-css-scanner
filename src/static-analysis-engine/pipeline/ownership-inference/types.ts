import type { AnalysisConfidence, AnalysisTrace } from "../../types/analysis.js";
import type { FactNodeId } from "../fact-graph/index.js";
import type { ClassOwnershipEvidenceKind, ProjectAnalysisId } from "../project-analysis/index.js";
import type { SelectorBranchMatchId } from "../selector-reachability/index.js";

export type OwnershipEvidenceId = string;
export type OwnershipCandidateId = string;
export type OwnershipClassificationId = string;
export type OwnershipInferenceDiagnosticId = string;

export type OwnershipInferenceResult = {
  meta: OwnershipInferenceMeta;
  classOwnership: ClassOwnershipEvidence[];
  definitionConsumers: ClassDefinitionConsumerEvidence[];
  ownerCandidates: StyleOwnerCandidate[];
  stylesheetOwnership: StylesheetOwnershipEvidence[];
  classifications: StyleClassificationEvidence[];
  diagnostics: OwnershipInferenceDiagnostic[];
  indexes: OwnershipInferenceIndexes;
};

export type OwnershipInferenceMeta = {
  generatedAtStage: "ownership-inference";
  classOwnershipCount: number;
  definitionConsumerCount: number;
  ownerCandidateCount: number;
  stylesheetOwnershipCount: number;
  classificationCount: number;
  diagnosticCount: number;
};

export type OwnershipEvidenceKind =
  | "private-component"
  | "single-consuming-component"
  | "shared-component-family"
  | "broad-stylesheet"
  | "contextual-selector"
  | "module-local"
  | "unresolved";

export type ClassOwnershipEvidence = {
  id: OwnershipEvidenceId;
  classDefinitionId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  className: string;
  consumerSummary: ClassConsumerSummary;
  ownerCandidateIds: OwnershipCandidateId[];
  classificationIds: OwnershipClassificationId[];
  evidenceKind: OwnershipEvidenceKind;
  compatibilityEvidenceKind?: ClassOwnershipEvidenceKind;
  confidence: AnalysisConfidence;
  actable: boolean;
  traces: AnalysisTrace[];
};

export type ClassConsumerSummary = {
  classDefinitionId: ProjectAnalysisId;
  className: string;
  consumerComponentIds: ProjectAnalysisId[];
  consumerSourceFileIds: ProjectAnalysisId[];
  referenceIds: ProjectAnalysisId[];
  matchIds: ProjectAnalysisId[];
};

export type ClassDefinitionConsumerEvidence = {
  id: OwnershipEvidenceId;
  classDefinitionId: ProjectAnalysisId;
  referenceId: ProjectAnalysisId;
  matchId?: ProjectAnalysisId;
  consumingComponentId?: ProjectAnalysisId;
  emittingComponentId?: ProjectAnalysisId;
  supplyingComponentId?: ProjectAnalysisId;
  consumingSourceFileId: ProjectAnalysisId;
  selectorBranchNodeIds: FactNodeId[];
  selectorMatchIds: SelectorBranchMatchId[];
  availability: OwnershipConsumerAvailability;
  consumptionKind: OwnershipConsumptionKind;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
};

export type OwnershipConsumerAvailability = "definite" | "possible" | "unknown" | "unavailable";

export type OwnershipConsumptionKind =
  | "direct-reference"
  | "forwarded-prop"
  | "slot-child"
  | "selector-context"
  | "css-module-member"
  | "unknown";

export type StyleOwnerCandidate = {
  id: OwnershipCandidateId;
  targetKind: OwnershipCandidateTargetKind;
  targetId: ProjectAnalysisId;
  ownerKind: OwnershipCandidateOwnerKind;
  ownerId?: ProjectAnalysisId;
  ownerPath?: string;
  confidence: AnalysisConfidence;
  actable: boolean;
  reasons: OwnershipCandidateReason[];
  traces: AnalysisTrace[];
};

export type OwnershipCandidateTargetKind =
  | "class-definition"
  | "stylesheet"
  | "css-module"
  | "directory";

export type OwnershipCandidateOwnerKind =
  | "component"
  | "source-file"
  | "directory"
  | "shared-layer"
  | "unknown";

export type OwnershipCandidateReason =
  | "single-importing-component"
  | "single-consuming-component"
  | "same-directory"
  | "sibling-basename-convention"
  | "component-folder-convention"
  | "feature-folder-convention"
  | "configured-shared-css"
  | "broad-stylesheet-segment"
  | "generic-family-stylesheet"
  | "selector-context-owner"
  | "css-module-import-owner"
  | "multi-consumer"
  | "unknown";

export type StylesheetOwnershipEvidence = {
  id: OwnershipEvidenceId;
  stylesheetId: ProjectAnalysisId;
  importerComponentIds: ProjectAnalysisId[];
  importerSourceFileIds: ProjectAnalysisId[];
  ownerCandidateIds: OwnershipCandidateId[];
  broadness: StylesheetOwnershipBroadness;
  configuredShared: boolean;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
};

export type StylesheetOwnershipBroadness =
  | "private-component-like"
  | "feature-like"
  | "shared-like"
  | "global-like"
  | "unknown";

export type StyleClassificationEvidence = {
  id: OwnershipClassificationId;
  targetKind: OwnershipClassificationTargetKind;
  targetId: ProjectAnalysisId | FactNodeId;
  className?: string;
  classification: OwnershipClassification;
  confidence: AnalysisConfidence;
  reasons: OwnershipCandidateReason[];
  traces: AnalysisTrace[];
};

export type OwnershipClassificationTargetKind =
  | "class-definition"
  | "stylesheet"
  | "selector-branch";

export type OwnershipClassification =
  | "private"
  | "single-consumer"
  | "shared"
  | "broad"
  | "contextual"
  | "generic-state"
  | "primitive-override"
  | "unresolved";

export type OwnershipInferenceDiagnostic = {
  id: OwnershipInferenceDiagnosticId;
  targetKind: OwnershipDiagnosticTargetKind;
  targetId: ProjectAnalysisId | FactNodeId;
  severity: "debug" | "warning";
  code: OwnershipInferenceDiagnosticCode;
  message: string;
  traces: AnalysisTrace[];
};

export type OwnershipDiagnosticTargetKind =
  | "class-definition"
  | "stylesheet"
  | "reference"
  | "selector-branch";

export type OwnershipInferenceDiagnosticCode =
  | "unresolved-ownership"
  | "contradictory-ownership-evidence";

export type OwnershipInferenceIndexes = {
  classOwnershipById: Map<OwnershipEvidenceId, ClassOwnershipEvidence>;
  classOwnershipIdsByClassDefinitionId: Map<ProjectAnalysisId, OwnershipEvidenceId[]>;
  classOwnershipIdsByStylesheetId: Map<ProjectAnalysisId, OwnershipEvidenceId[]>;
  classOwnershipIdsByClassName: Map<string, OwnershipEvidenceId[]>;
  consumerEvidenceById: Map<OwnershipEvidenceId, ClassDefinitionConsumerEvidence>;
  consumerEvidenceIdsByClassDefinitionId: Map<ProjectAnalysisId, OwnershipEvidenceId[]>;
  consumerEvidenceIdsByComponentId: Map<ProjectAnalysisId, OwnershipEvidenceId[]>;
  ownerCandidateById: Map<OwnershipCandidateId, StyleOwnerCandidate>;
  ownerCandidateIdsByOwnerComponentId: Map<ProjectAnalysisId, OwnershipCandidateId[]>;
  ownerCandidateIdsByStylesheetId: Map<ProjectAnalysisId, OwnershipCandidateId[]>;
  stylesheetOwnershipById: Map<OwnershipEvidenceId, StylesheetOwnershipEvidence>;
  stylesheetOwnershipByStylesheetId: Map<ProjectAnalysisId, StylesheetOwnershipEvidence>;
  classificationById: Map<OwnershipClassificationId, StyleClassificationEvidence>;
  classificationIdsByTargetId: Map<ProjectAnalysisId | FactNodeId, OwnershipClassificationId[]>;
  diagnosticById: Map<OwnershipInferenceDiagnosticId, OwnershipInferenceDiagnostic>;
  diagnosticsByTargetId: Map<ProjectAnalysisId | FactNodeId, OwnershipInferenceDiagnosticId[]>;
};
