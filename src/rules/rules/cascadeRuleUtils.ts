import type {
  AnalysisEvidence,
  CascadeDeclarationCandidate,
  CascadeOutcome,
  CssDeclarationAnalysis,
} from "../../static-analysis-engine/index.js";

export type DefiniteCascadeLoss = {
  candidate: CascadeDeclarationCandidate;
  outcome: CascadeOutcome;
  winningCandidate: CascadeDeclarationCandidate;
  declaration: CssDeclarationAnalysis;
  winningDeclaration?: CssDeclarationAnalysis;
};

export function collectDefiniteCascadeLosses(analysis: AnalysisEvidence): DefiniteCascadeLoss[] {
  const losses: DefiniteCascadeLoss[] = [];
  const cascade = analysis.cascadeAnalysis;

  for (const outcome of cascade.outcomes) {
    if (
      outcome.certainty !== "definite" ||
      !outcome.winningCandidateId ||
      outcome.unresolvedCandidateIds.length > 0 ||
      outcome.conditionalBranches?.length
    ) {
      continue;
    }

    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    if (!winningCandidate || winningCandidate.matchCertainty !== "definite") {
      continue;
    }

    for (const candidateId of outcome.losingCandidateIds) {
      const candidate = cascade.indexes.candidateById.get(candidateId);
      if (
        !candidate?.declarationId ||
        candidate.matchCertainty !== "definite" ||
        candidate.property !== outcome.property ||
        candidate.value === winningCandidate.value ||
        hasCandidateDiagnostics(analysis, candidate) ||
        hasCandidateDiagnostics(analysis, winningCandidate)
      ) {
        continue;
      }

      const declaration = analysis.projectEvidence.indexes.cssDeclarationsById.get(
        candidate.declarationId,
      );
      if (!declaration) {
        continue;
      }

      const winningDeclaration = winningCandidate.declarationId
        ? analysis.projectEvidence.indexes.cssDeclarationsById.get(winningCandidate.declarationId)
        : undefined;

      losses.push({
        candidate,
        outcome,
        winningCandidate,
        declaration,
        ...(winningDeclaration ? { winningDeclaration } : {}),
      });
    }
  }

  return losses.sort(
    (left, right) =>
      left.declaration.id.localeCompare(right.declaration.id) ||
      left.winningCandidate.id.localeCompare(right.winningCandidate.id) ||
      left.candidate.elementId.localeCompare(right.candidate.elementId) ||
      left.candidate.property.localeCompare(right.candidate.property),
  );
}

export function dedupeLossesByKey(
  losses: DefiniteCascadeLoss[],
  getKey: (loss: DefiniteCascadeLoss) => string,
): DefiniteCascadeLoss[] {
  const seen = new Set<string>();
  const result: DefiniteCascadeLoss[] = [];
  for (const loss of losses) {
    const key = getKey(loss);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(loss);
  }
  return result;
}

export function formatCandidateSource(candidate: CascadeDeclarationCandidate): string {
  return candidate.declarationId
    ? `${candidate.declaredProperty}: ${candidate.declaredValue}`
    : `inline ${candidate.declaredProperty}: ${candidate.declaredValue}`;
}

function hasCandidateDiagnostics(
  analysis: AnalysisEvidence,
  candidate: CascadeDeclarationCandidate,
): boolean {
  if (
    candidate.declarationId &&
    (analysis.cascadeAnalysis.indexes.diagnosticIdsByDeclarationId.get(candidate.declarationId)
      ?.length ?? 0) > 0
  ) {
    return true;
  }

  if (!candidate.selectorBranchId) {
    return false;
  }

  return (
    (analysis.cascadeAnalysis.indexes.diagnosticIdsBySelectorBranchId.get(
      candidate.selectorBranchId,
    )?.length ?? 0) > 0
  );
}
