import type { AnalysisConfidence, AnalysisTrace } from "../../types/analysis.js";
import type { FactNodeId } from "../fact-graph/index.js";
import type { ProjectEvidenceId } from "../project-evidence/index.js";
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
  classDefinitionId: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  className: string;
  consumerSummary: ClassConsumerSummary;
  ownerCandidateIds: OwnershipCandidateId[];
  classificationIds: OwnershipClassificationId[];
  evidenceKind: OwnershipEvidenceKind;
  compatibilityEvidenceKind?: ClassOwnershipCompatibilityEvidenceKind;
  confidence: AnalysisConfidence;
  actable: boolean;
  traces: AnalysisTrace[];
};

export type ClassOwnershipCompatibilityEvidenceKind =
  | "single-importing-component"
  | "single-consuming-component"
  | "multi-consumer"
  | "path-convention"
  | "unknown";

export type ClassConsumerSummary = {
  classDefinitionId: ProjectEvidenceId;
  className: string;
  consumerComponentIds: ProjectEvidenceId[];
  consumerSourceFileIds: ProjectEvidenceId[];
  referenceIds: ProjectEvidenceId[];
  matchIds: ProjectEvidenceId[];
};

export type ClassDefinitionConsumerEvidence = {
  id: OwnershipEvidenceId;
  classDefinitionId: ProjectEvidenceId;
  referenceId: ProjectEvidenceId;
  matchId?: ProjectEvidenceId;
  consumingComponentId?: ProjectEvidenceId;
  emittingComponentId?: ProjectEvidenceId;
  supplyingComponentId?: ProjectEvidenceId;
  consumingSourceFileId: ProjectEvidenceId;
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
  targetId: ProjectEvidenceId;
  ownerKind: OwnershipCandidateOwnerKind;
  ownerId?: ProjectEvidenceId;
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

export type IntentionalSharedEvidenceKind =
  | "configured-shared-css"
  | "broad-stylesheet-segment"
  | "html-entry-linked"
  | "consumer-same-directory"
  | "consumer-ancestor-directory"
  | "generic-family-stylesheet";

export type StylesheetConsumerDirectoryRelation = {
  stylesheetId: ProjectEvidenceId;
  consumerComponentId: ProjectEvidenceId;
  relation:
    | "same-directory"
    | "ancestor-directory"
    | "descendant-directory"
    | "sibling-directory"
    | "cousin-directory"
    | "unknown";
  stylesheetDirectoryPath?: string;
  consumerDirectoryPath?: string;
};

export type StylesheetOwnershipEvidence = {
  id: OwnershipEvidenceId;
  stylesheetId: ProjectEvidenceId;
  importerComponentIds: ProjectEvidenceId[];
  importerSourceFileIds: ProjectEvidenceId[];
  ownerCandidateIds: OwnershipCandidateId[];
  broadness: StylesheetOwnershipBroadness;
  configuredShared: boolean;
  sharingPolicy: "strict" | "balanced" | "permissive";
  intentionalSharedEvidenceKinds: IntentionalSharedEvidenceKind[];
  consumerDirectoryRelations: StylesheetConsumerDirectoryRelation[];
  isHtmlEntryLinked: boolean;
  isIntentionallySharedByPolicy: boolean;
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
  targetId: ProjectEvidenceId | FactNodeId;
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
  targetId: ProjectEvidenceId | FactNodeId;
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
  classOwnershipIdsByClassDefinitionId: Map<ProjectEvidenceId, OwnershipEvidenceId[]>;
  classOwnershipIdsByStylesheetId: Map<ProjectEvidenceId, OwnershipEvidenceId[]>;
  classOwnershipIdsByClassName: Map<string, OwnershipEvidenceId[]>;
  consumerEvidenceById: Map<OwnershipEvidenceId, ClassDefinitionConsumerEvidence>;
  consumerEvidenceIdsByClassDefinitionId: Map<ProjectEvidenceId, OwnershipEvidenceId[]>;
  consumerEvidenceIdsByComponentId: Map<ProjectEvidenceId, OwnershipEvidenceId[]>;
  ownerCandidateById: Map<OwnershipCandidateId, StyleOwnerCandidate>;
  ownerCandidateIdsByOwnerComponentId: Map<ProjectEvidenceId, OwnershipCandidateId[]>;
  ownerCandidateIdsByStylesheetId: Map<ProjectEvidenceId, OwnershipCandidateId[]>;
  stylesheetOwnershipById: Map<OwnershipEvidenceId, StylesheetOwnershipEvidence>;
  stylesheetOwnershipByStylesheetId: Map<ProjectEvidenceId, StylesheetOwnershipEvidence>;
  stylesheetIntentionalSharedKindsByStylesheetId: Map<
    ProjectEvidenceId,
    IntentionalSharedEvidenceKind[]
  >;
  consumerDirectoryRelationsByStylesheetId: Map<
    ProjectEvidenceId,
    StylesheetConsumerDirectoryRelation[]
  >;
  consumerDirectoryRelationsByComponentId: Map<
    ProjectEvidenceId,
    StylesheetConsumerDirectoryRelation[]
  >;
  intentionallySharedStylesheetIds: Set<ProjectEvidenceId>;
  classificationById: Map<OwnershipClassificationId, StyleClassificationEvidence>;
  classificationIdsByTargetId: Map<ProjectEvidenceId | FactNodeId, OwnershipClassificationId[]>;
  diagnosticById: Map<OwnershipInferenceDiagnosticId, OwnershipInferenceDiagnostic>;
  diagnosticsByTargetId: Map<ProjectEvidenceId | FactNodeId, OwnershipInferenceDiagnosticId[]>;
};
