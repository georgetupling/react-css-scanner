import { styleOwnerCandidateId } from "./ids.js";
import type {
  ClassOwnershipAnalysis,
  ClassOwnershipEvidenceKind,
  OwnerCandidate,
  OwnerCandidateReason,
} from "../project-analysis/index.js";
import type {
  ClassOwnershipEvidence,
  OwnershipCandidateReason,
  OwnershipEvidenceKind,
  OwnershipInferenceResult,
  StyleOwnerCandidate,
} from "./types.js";

export function ownershipEvidenceFromClassOwnershipAnalysis(
  ownershipAnalysis: ClassOwnershipAnalysis[],
): Pick<OwnershipInferenceResult, "classOwnership" | "ownerCandidates"> {
  const ownerCandidates: StyleOwnerCandidate[] = [];
  const classOwnership = ownershipAnalysis
    .map((ownership) => {
      const ownerCandidateIds = ownership.ownerCandidates.map((candidate) => {
        const reasons = normalizeReasons(candidate.reasons);
        const ownerCandidate: StyleOwnerCandidate = {
          id: styleOwnerCandidateId({
            targetKind: "class-definition",
            targetId: ownership.classDefinitionId,
            ownerKind: mapOwnerCandidateKind(candidate.kind),
            ownerId: candidate.id,
            ownerPath: candidate.path,
            reasonKey: reasons.join("|"),
          }),
          targetKind: "class-definition",
          targetId: ownership.classDefinitionId,
          ownerKind: mapOwnerCandidateKind(candidate.kind),
          ownerId: candidate.id,
          ownerPath: candidate.path,
          confidence: candidate.confidence,
          actable: isActableOwnerCandidate(candidate),
          reasons,
          traces: candidate.traces,
        };
        ownerCandidates.push(ownerCandidate);
        return ownerCandidate.id;
      });

      return {
        id: ownership.id,
        classDefinitionId: ownership.classDefinitionId,
        stylesheetId: ownership.stylesheetId,
        className: ownership.className,
        consumerSummary: ownership.consumerSummary,
        ownerCandidateIds: [...ownerCandidateIds].sort((left, right) => left.localeCompare(right)),
        classificationIds: [],
        evidenceKind: mapOwnershipEvidenceKind(ownership.evidenceKind),
        compatibilityEvidenceKind: ownership.evidenceKind,
        confidence: ownership.confidence,
        actable: ownerCandidateIds.length > 0 && ownership.confidence !== "low",
        traces: ownership.traces,
      } satisfies ClassOwnershipEvidence;
    })
    .sort(compareById);

  return {
    classOwnership,
    ownerCandidates: dedupeOwnerCandidates(ownerCandidates),
  };
}

export function classOwnershipAnalysisFromOwnershipInference(
  result: OwnershipInferenceResult,
): ClassOwnershipAnalysis[] {
  return result.classOwnership
    .map((ownership) => ({
      id: ownership.id,
      classDefinitionId: ownership.classDefinitionId,
      stylesheetId: ownership.stylesheetId,
      className: ownership.className,
      consumerSummary: ownership.consumerSummary,
      ownerCandidates: ownership.ownerCandidateIds
        .map((candidateId) => result.indexes.ownerCandidateById.get(candidateId))
        .filter((candidate): candidate is StyleOwnerCandidate => Boolean(candidate))
        .map(projectAnalysisOwnerCandidateFromEvidence),
      evidenceKind:
        ownership.compatibilityEvidenceKind ??
        projectAnalysisEvidenceKindFromOwnershipEvidence(ownership.evidenceKind),
      confidence: ownership.confidence,
      traces: ownership.traces,
    }))
    .sort(compareById);
}

function projectAnalysisOwnerCandidateFromEvidence(candidate: StyleOwnerCandidate): OwnerCandidate {
  return {
    kind: mapProjectAnalysisOwnerCandidateKind(candidate.ownerKind),
    id: candidate.ownerId,
    path: candidate.ownerPath,
    confidence: candidate.confidence,
    reasons: candidate.reasons
      .filter(isProjectAnalysisOwnerReason)
      .sort((left, right) => left.localeCompare(right)),
    traces: candidate.traces,
  };
}

function mapOwnershipEvidenceKind(kind: ClassOwnershipEvidenceKind): OwnershipEvidenceKind {
  switch (kind) {
    case "single-importing-component":
      return "private-component";
    case "single-consuming-component":
      return "single-consuming-component";
    case "multi-consumer":
      return "shared-component-family";
    case "path-convention":
      return "private-component";
    case "unknown":
      return "unresolved";
  }
}

function projectAnalysisEvidenceKindFromOwnershipEvidence(
  kind: OwnershipEvidenceKind,
): ClassOwnershipEvidenceKind {
  switch (kind) {
    case "private-component":
    case "module-local":
      return "path-convention";
    case "single-consuming-component":
      return "single-consuming-component";
    case "shared-component-family":
    case "broad-stylesheet":
    case "contextual-selector":
      return "multi-consumer";
    case "unresolved":
      return "unknown";
  }
}

function mapOwnerCandidateKind(
  candidateKind: OwnerCandidate["kind"],
): StyleOwnerCandidate["ownerKind"] {
  switch (candidateKind) {
    case "component":
      return "component";
    case "source-file":
      return "source-file";
    case "directory":
      return "directory";
    case "unknown":
      return "unknown";
  }
}

function mapProjectAnalysisOwnerCandidateKind(
  candidateKind: StyleOwnerCandidate["ownerKind"],
): OwnerCandidate["kind"] {
  switch (candidateKind) {
    case "component":
      return "component";
    case "source-file":
      return "source-file";
    case "directory":
      return "directory";
    case "shared-layer":
    case "unknown":
      return "unknown";
  }
}

function isActableOwnerCandidate(candidate: OwnerCandidate): boolean {
  return (
    candidate.kind === "component" &&
    candidate.confidence !== "low" &&
    candidate.reasons.some((reason) =>
      [
        "single-importing-component",
        "single-consuming-component",
        "sibling-basename-convention",
        "component-folder-convention",
      ].includes(reason),
    )
  );
}

function normalizeReasons(reasons: OwnerCandidateReason[]): OwnershipCandidateReason[] {
  return reasons
    .filter(isOwnershipCandidateReason)
    .sort((left, right) => left.localeCompare(right));
}

function isOwnershipCandidateReason(reason: string): reason is OwnershipCandidateReason {
  return [
    "single-importing-component",
    "single-consuming-component",
    "same-directory",
    "sibling-basename-convention",
    "component-folder-convention",
    "feature-folder-convention",
    "configured-shared-css",
    "broad-stylesheet-segment",
    "generic-family-stylesheet",
    "selector-context-owner",
    "css-module-import-owner",
    "multi-consumer",
    "unknown",
  ].includes(reason);
}

function isProjectAnalysisOwnerReason(reason: string): reason is OwnerCandidateReason {
  return [
    "single-importing-component",
    "single-consuming-component",
    "same-directory",
    "sibling-basename-convention",
    "component-folder-convention",
    "feature-folder-convention",
    "multi-consumer",
    "unknown",
  ].includes(reason);
}

function dedupeOwnerCandidates(candidates: StyleOwnerCandidate[]): StyleOwnerCandidate[] {
  const byId = new Map<string, StyleOwnerCandidate>();
  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort(compareById);
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
