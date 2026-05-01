import {
  selectorBranchSourceKey,
  type AnalysisEvidence,
  type ClassDefinitionAnalysis,
  type ClassReferenceAnalysis,
  type ClassReferenceMatchRelation,
  type ClassContextAnalysis,
  type ComponentAnalysis,
  type CssModuleImportAnalysis,
  type CssModuleMemberMatchRelation,
  type CssModuleMemberReferenceAnalysis,
  type ProjectAnalysisId,
  type ProviderClassSatisfactionRelation,
  type SelectorBranchAnalysis,
  type SelectorBranchReachability,
  type SelectorQueryAnalysis,
  type SourceFileAnalysis,
  type StaticallySkippedClassReferenceAnalysis,
  type StylesheetAnalysis,
  type StylesheetReachabilityRelation,
  type UnsupportedClassReferenceAnalysis,
  type StyleOwnerCandidate,
  type ClassOwnershipEvidence,
} from "../static-analysis-engine/index.js";

export type HydratedClassOwnershipEvidence = ClassOwnershipEvidence & {
  ownerCandidates: StyleOwnerCandidate[];
};

export function getSourceFileById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): SourceFileAnalysis | undefined {
  return analysis.projectEvidence.indexes.sourceFilesById.get(id);
}

export function getStylesheetById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): StylesheetAnalysis | undefined {
  return analysis.projectEvidence.indexes.stylesheetsById.get(id);
}

export function getComponentById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): ComponentAnalysis | undefined {
  return analysis.projectEvidence.indexes.componentsById.get(id);
}

export function getClassDefinitionById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): ClassDefinitionAnalysis | undefined {
  return analysis.projectEvidence.indexes.classDefinitionsById.get(id);
}

export function getClassDefinitionsByClassName(
  analysis: AnalysisEvidence,
  className: string,
): ClassDefinitionAnalysis[] {
  return resolveIds(
    analysis.projectEvidence.indexes.classDefinitionIdsByClassName.get(className),
    analysis.projectEvidence.indexes.classDefinitionsById,
  );
}

export function getClassDefinitionsByStylesheetId(
  analysis: AnalysisEvidence,
  stylesheetId: ProjectAnalysisId,
): ClassDefinitionAnalysis[] {
  return resolveIds(
    analysis.projectEvidence.indexes.classDefinitionIdsByStylesheetId.get(stylesheetId),
    analysis.projectEvidence.indexes.classDefinitionsById,
  );
}

export function getClassContextsByClassName(
  analysis: AnalysisEvidence,
  className: string,
): ClassContextAnalysis[] {
  return analysis.projectEvidence.entities.classContexts.filter(
    (context) => context.className === className,
  );
}

export function getClassReferencesByClassName(
  analysis: AnalysisEvidence,
  className: string,
): ClassReferenceAnalysis[] {
  return resolveIds(
    analysis.projectEvidence.indexes.classReferenceIdsByClassName.get(className),
    analysis.projectEvidence.indexes.classReferencesById,
  );
}

export function getClassReferenceById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): ClassReferenceAnalysis | undefined {
  return analysis.projectEvidence.indexes.classReferencesById.get(id);
}

export function getStaticallySkippedClassReferencesByClassName(
  analysis: AnalysisEvidence,
  className: string,
): StaticallySkippedClassReferenceAnalysis[] {
  return analysis.projectEvidence.entities.staticallySkippedClassReferences.filter(
    (reference) =>
      reference.definiteClassNames.includes(className) ||
      reference.possibleClassNames.includes(className),
  );
}

export function getUnsupportedClassReferences(
  analysis: AnalysisEvidence,
): UnsupportedClassReferenceAnalysis[] {
  return analysis.projectEvidence.entities.unsupportedClassReferences;
}

export function getReferenceMatchesByDefinitionId(
  analysis: AnalysisEvidence,
  definitionId: ProjectAnalysisId,
): ClassReferenceMatchRelation[] {
  return resolveRelationIds(
    analysis.projectEvidence.indexes.classReferenceMatchIdsByDefinitionId.get(definitionId),
    analysis.projectEvidence.relations.referenceMatches,
  );
}

export function getReferenceMatchesByReferenceId(
  analysis: AnalysisEvidence,
  referenceId: ProjectAnalysisId,
): ClassReferenceMatchRelation[] {
  return resolveRelationIds(
    analysis.projectEvidence.indexes.classReferenceMatchIdsByReferenceId.get(referenceId),
    analysis.projectEvidence.relations.referenceMatches,
  );
}

export function getReferenceMatchesByReferenceAndClassName(
  analysis: AnalysisEvidence,
  referenceId: ProjectAnalysisId,
  className: string,
): ClassReferenceMatchRelation[] {
  return getReferenceMatchesByReferenceId(analysis, referenceId).filter(
    (match) => match.className === className,
  );
}

export function hasProviderSatisfactionForReferenceClass(input: {
  analysis: AnalysisEvidence;
  referenceId: ProjectAnalysisId;
  className: string;
}): boolean {
  return getProviderSatisfactionsByReferenceAndClassName(input).length > 0;
}

export function getProviderSatisfactionsByReferenceAndClassName(input: {
  analysis: AnalysisEvidence;
  referenceId: ProjectAnalysisId;
  className: string;
}): ProviderClassSatisfactionRelation[] {
  return input.analysis.projectEvidence.relations.providerClassSatisfactions.filter(
    (satisfaction) =>
      satisfaction.referenceId === input.referenceId && satisfaction.className === input.className,
  );
}

export function getStylesheetReachabilityByStylesheetId(
  analysis: AnalysisEvidence,
  stylesheetId: ProjectAnalysisId,
): StylesheetReachabilityRelation[] {
  return analysis.projectEvidence.relations.stylesheetReachability.filter(
    (relation) => relation.stylesheetId === stylesheetId,
  );
}

export function getSelectorBranchById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): SelectorBranchAnalysis | undefined {
  return analysis.projectEvidence.entities.selectorBranches.find((branch) => branch.id === id);
}

export function getSelectorQueryById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): SelectorQueryAnalysis | undefined {
  return analysis.projectEvidence.entities.selectorQueries.find((query) => query.id === id);
}

export function getSelectorBranchesByStylesheetId(
  analysis: AnalysisEvidence,
  stylesheetId: ProjectAnalysisId,
): SelectorBranchAnalysis[] {
  return resolveSelectorBranchIds(
    analysis.projectEvidence.indexes.selectorBranchIdsByStylesheetId.get(stylesheetId),
    analysis,
  );
}

export function getSelectorReachabilityBranches(
  analysis: AnalysisEvidence,
): SelectorBranchReachability[] {
  return analysis.selectorReachability.selectorBranches;
}

export function getSelectorReachabilityBranchesByRequiredClassName(
  analysis: AnalysisEvidence,
  className: string,
): SelectorBranchReachability[] {
  return (analysis.selectorReachability.indexes.branchIdsByRequiredClassName.get(className) ?? [])
    .map((branchId) =>
      analysis.selectorReachability.indexes.branchReachabilityBySelectorBranchNodeId.get(branchId),
    )
    .filter((branch): branch is SelectorBranchReachability => Boolean(branch));
}

export function getProjectSelectorBranchForReachability(
  analysis: AnalysisEvidence,
  branch: SelectorBranchReachability,
): SelectorBranchAnalysis | undefined {
  const sourceKey = selectorBranchSourceKey({
    ruleKey: branch.ruleKey,
    branchIndex: branch.branchIndex,
    selectorText: branch.branchText,
    location: branch.location,
  });

  return analysis.projectEvidence.entities.selectorBranches.find((candidate) => {
    const source = candidate.sourceQuery.sourceResult.source;
    if (source.kind !== "css-source") {
      return false;
    }

    return (
      selectorBranchSourceKey({
        ruleKey: source.ruleKey,
        branchIndex: source.branchIndex,
        selectorText: candidate.selectorText,
        location: source.selectorAnchor,
      }) === sourceKey
    );
  });
}

export function getProjectSelectorQueryForReachability(
  analysis: AnalysisEvidence,
  branch: SelectorBranchReachability,
): SelectorQueryAnalysis | undefined {
  const projectBranch = getProjectSelectorBranchForReachability(analysis, branch);
  return projectBranch ? getSelectorQueryById(analysis, projectBranch.selectorQueryId) : undefined;
}

export function getCssModuleImportById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): CssModuleImportAnalysis | undefined {
  return analysis.projectEvidence.entities.cssModuleImports.find(
    (importRecord) => importRecord.id === id,
  );
}

export function getCssModuleImportsByStylesheetId(
  analysis: AnalysisEvidence,
  stylesheetId: ProjectAnalysisId,
): CssModuleImportAnalysis[] {
  return analysis.projectEvidence.entities.cssModuleImports.filter(
    (importRecord) => importRecord.stylesheetId === stylesheetId,
  );
}

export function getCssModuleMemberReferenceById(
  analysis: AnalysisEvidence,
  id: ProjectAnalysisId,
): CssModuleMemberReferenceAnalysis | undefined {
  return analysis.projectEvidence.entities.cssModuleMemberReferences.find(
    (reference) => reference.id === id,
  );
}

export function getCssModuleMemberMatchesByDefinitionId(
  analysis: AnalysisEvidence,
  definitionId: ProjectAnalysisId,
): CssModuleMemberMatchRelation[] {
  return analysis.projectEvidence.relations.cssModuleMemberMatches.filter(
    (match) => match.definitionId === definitionId,
  );
}

export function getCssModuleMemberMatchesByReferenceId(
  analysis: AnalysisEvidence,
  referenceId: ProjectAnalysisId,
): CssModuleMemberMatchRelation[] {
  return analysis.projectEvidence.relations.cssModuleMemberMatches.filter(
    (match) => match.referenceId === referenceId,
  );
}

export function getClassOwnershipEvidence(
  analysis: AnalysisEvidence,
): HydratedClassOwnershipEvidence[] {
  return analysis.ownershipInference.classOwnership
    .map((ownership) => ({
      ...ownership,
      ownerCandidates: ownership.ownerCandidateIds
        .map((candidateId) =>
          analysis.ownershipInference.indexes.ownerCandidateById.get(candidateId),
        )
        .filter((candidate): candidate is StyleOwnerCandidate => Boolean(candidate)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getClassOwnershipEvidenceByDefinitionId(
  analysis: AnalysisEvidence,
  definitionId: ProjectAnalysisId,
): HydratedClassOwnershipEvidence[] {
  const ownershipIds =
    analysis.ownershipInference.indexes.classOwnershipIdsByClassDefinitionId.get(definitionId);
  return resolveIds(ownershipIds, analysis.ownershipInference.indexes.classOwnershipById).map(
    (ownership) => ({
      ...ownership,
      ownerCandidates: ownership.ownerCandidateIds
        .map((candidateId) =>
          analysis.ownershipInference.indexes.ownerCandidateById.get(candidateId),
        )
        .filter((candidate): candidate is StyleOwnerCandidate => Boolean(candidate)),
    }),
  );
}

export function getOwnerCandidateById(
  analysis: AnalysisEvidence,
  id: string,
): StyleOwnerCandidate | undefined {
  return analysis.ownershipInference.indexes.ownerCandidateById.get(id);
}

function resolveIds<TValue>(ids: string[] | undefined, valuesById: Map<string, TValue>): TValue[] {
  return (ids ?? [])
    .map((id) => valuesById.get(id))
    .filter((value): value is TValue => Boolean(value));
}

function resolveSelectorBranchIds(
  ids: string[] | undefined,
  analysis: AnalysisEvidence,
): SelectorBranchAnalysis[] {
  return (ids ?? [])
    .map((id) => getSelectorBranchById(analysis, id))
    .filter((branch): branch is SelectorBranchAnalysis => Boolean(branch));
}

function resolveRelationIds<TRelation extends { id: string }>(
  ids: string[] | undefined,
  relations: TRelation[],
): TRelation[] {
  if (!ids || ids.length === 0) {
    return [];
  }

  const relationById = new Map(relations.map((relation) => [relation.id, relation]));
  return ids
    .map((id) => relationById.get(id))
    .filter((relation): relation is TRelation => Boolean(relation));
}
