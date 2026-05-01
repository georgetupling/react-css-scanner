import type { ProjectAnalysis, ProjectAnalysisBuildInput } from "./types.js";
import {
  createEmptyIndexes,
  indexEntities,
  indexRelations,
  indexClassOwnership,
} from "./internal/indexes.js";
import {
  buildProjectEvidence,
  buildProjectEvidenceEntities,
  buildProjectEvidenceRelations,
} from "../project-evidence/index.js";
import {
  buildOwnershipInference,
  classOwnershipAnalysisFromOwnershipInference,
} from "../ownership-inference/index.js";

export function buildProjectAnalysis(input: ProjectAnalysisBuildInput): ProjectAnalysis {
  const includeTraces = input.includeTraces ?? true;
  const indexes = createEmptyIndexes();
  const projectEvidence = buildProjectEvidence({
    entities: buildProjectEvidenceEntities({
      projectInput: input,
      indexes,
      includeTraces,
    }),
  });
  const {
    sourceFiles,
    stylesheets,
    classReferences,
    staticallySkippedClassReferences,
    classDefinitions,
    classContexts,
    selectorQueries,
    selectorBranches,
    components,
    renderSubtrees,
    unsupportedClassReferences,
    cssModuleImports,
    cssModuleAliases,
    cssModuleDestructuredBindings,
    cssModuleMemberReferences,
    cssModuleReferenceDiagnostics,
  } = projectEvidence.entities;
  indexEntities({
    sourceFiles,
    stylesheets,
    classReferences,
    staticallySkippedClassReferences,
    classDefinitions,
    classContexts,
    selectorQueries,
    selectorBranches,
    components,
    unsupportedClassReferences,
    cssModuleImports,
    cssModuleAliases,
    cssModuleDestructuredBindings,
    cssModuleMemberReferences,
    cssModuleReferenceDiagnostics,
    indexes,
  });
  const projectEvidenceWithRelations = buildProjectEvidence({
    entities: projectEvidence.entities,
    relations: buildProjectEvidenceRelations({
      projectInput: input,
      entities: projectEvidence.entities,
      indexes,
      includeTraces,
    }),
  });
  const {
    moduleImports,
    componentRenders,
    stylesheetReachability,
    referenceMatches,
    selectorMatches,
    providerClassSatisfactions,
    cssModuleMemberMatches,
  } = projectEvidenceWithRelations.relations;
  const ownershipInference = buildOwnershipInference({
    projectEvidence: projectEvidenceWithRelations,
    selectorReachability: input.selectorReachability ?? emptySelectorReachability(),
    options: {
      includeTraces,
      sharedCssPatterns: [],
    },
    compatibility: {
      projectInput: input,
      projectIndexes: indexes,
    },
  });
  const classOwnership = classOwnershipAnalysisFromOwnershipInference(ownershipInference);

  indexRelations({
    referenceMatches,
    providerClassSatisfactions,
    selectorMatches,
    cssModuleMemberMatches,
    indexes,
  });
  indexClassOwnership(classOwnership, indexes);

  return {
    meta: {
      sourceFileCount: sourceFiles.length,
      cssFileCount: stylesheets.length,
      externalCssEnabled: input.externalCssSummary.enabled,
    },
    inputs: {
      sourceFiles: sourceFiles.map(({ id, filePath }) => ({ id, filePath })),
      cssFiles: stylesheets.map(({ id, filePath }) => ({ id, filePath })),
      externalCss: input.externalCssSummary,
    },
    evidence: {
      ...(input.selectorReachability ? { selectorReachability: input.selectorReachability } : {}),
    },
    entities: {
      sourceFiles,
      stylesheets,
      classReferences,
      staticallySkippedClassReferences,
      classDefinitions,
      classContexts,
      selectorQueries,
      selectorBranches,
      classOwnership,
      components,
      renderSubtrees,
      unsupportedClassReferences,
      cssModuleImports,
      cssModuleAliases,
      cssModuleDestructuredBindings,
      cssModuleMemberReferences,
      cssModuleReferenceDiagnostics,
    },
    relations: {
      moduleImports,
      componentRenders,
      stylesheetReachability,
      referenceMatches,
      selectorMatches,
      providerClassSatisfactions,
      cssModuleMemberMatches,
    },
    indexes,
  };
}

function emptySelectorReachability(): NonNullable<
  ProjectAnalysisBuildInput["selectorReachability"]
> {
  return {
    meta: {
      generatedAtStage: "selector-reachability",
      selectorBranchCount: 0,
      elementMatchCount: 0,
      branchMatchCount: 0,
      diagnosticCount: 0,
    },
    selectorBranches: [],
    elementMatches: [],
    branchMatches: [],
    diagnostics: [],
    indexes: {
      branchReachabilityBySelectorBranchNodeId: new Map(),
      branchReachabilityBySourceKey: new Map(),
      matchById: new Map(),
      elementMatchById: new Map(),
      renderElementById: new Map(),
      emissionSiteById: new Map(),
      renderPathById: new Map(),
      unknownRegionById: new Map(),
      matchIdsBySelectorBranchNodeId: new Map(),
      matchIdsByElementId: new Map(),
      matchIdsByClassName: new Map(),
      matchIdsByEmissionSiteId: new Map(),
      matchIdsByRenderPathId: new Map(),
      matchIdsByPlacementConditionId: new Map(),
      renderPathIdsByElementId: new Map(),
      renderPathIdsByEmissionSiteId: new Map(),
      placementConditionIdsByElementId: new Map(),
      placementConditionIdsByEmissionSiteId: new Map(),
      emissionSiteIdsByElementId: new Map(),
      emissionSiteIdsByToken: new Map(),
      unknownClassElementIds: [],
      unknownClassEmissionSiteIds: [],
      unknownClassEmissionSiteIdsByElementId: new Map(),
      unknownRegionIdsByComponentNodeId: new Map(),
      unknownRegionIdsByRenderPathId: new Map(),
      branchIdsByRequiredClassName: new Map(),
      branchIdsByStylesheetNodeId: new Map(),
      diagnosticIdsBySelectorBranchNodeId: new Map(),
    },
  };
}
