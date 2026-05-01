import type { ProjectAnalysis, ProjectAnalysisBuildInput } from "./types.js";
import {
  createEmptyIndexes,
  indexRelations,
  indexClassOwnership,
  indexEntities,
} from "./internal/indexes.js";
import { classOwnershipAnalysisFromOwnershipInference } from "../ownership-inference/index.js";
import {
  buildAnalysisEvidenceWithCompatibilityIndexes,
  type AnalysisEvidence,
} from "../analysis-evidence/index.js";

export function buildProjectAnalysis(input: ProjectAnalysisBuildInput): ProjectAnalysis {
  return buildProjectAnalysisCompatibility(input).projectAnalysis;
}

export type ProjectAnalysisCompatibilityBuildResult = {
  analysisEvidence: AnalysisEvidence;
  projectAnalysis: ProjectAnalysis;
};

export type ProjectAnalysisFromEvidenceInput = Pick<
  ProjectAnalysisBuildInput,
  "externalCssSummary" | "selectorReachability"
>;

export function buildProjectAnalysisCompatibility(
  input: ProjectAnalysisBuildInput,
): ProjectAnalysisCompatibilityBuildResult {
  const { analysisEvidence, projectAnalysisIndexes } =
    buildAnalysisEvidenceWithCompatibilityIndexes(input);
  return {
    analysisEvidence,
    projectAnalysis: buildProjectAnalysisFromEvidence(
      input,
      analysisEvidence,
      projectAnalysisIndexes,
    ),
  };
}

export function buildProjectAnalysisFromEvidence(
  input: ProjectAnalysisFromEvidenceInput,
  analysisEvidence: AnalysisEvidence,
  projectAnalysisIndexes?: ProjectAnalysis["indexes"],
): ProjectAnalysis {
  const indexes = projectAnalysisIndexes ?? createEmptyIndexes();
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
  } = analysisEvidence.projectEvidence.entities;

  if (!projectAnalysisIndexes) {
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
  }
  const {
    moduleImports,
    componentRenders,
    stylesheetReachability,
    referenceMatches,
    selectorMatches,
    providerClassSatisfactions,
    cssModuleMemberMatches,
  } = analysisEvidence.projectEvidence.relations;
  const classOwnership = classOwnershipAnalysisFromOwnershipInference(
    analysisEvidence.ownershipInference,
  );

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
      ...(input.selectorReachability
        ? { selectorReachability: analysisEvidence.selectorReachability }
        : {}),
      ownershipInference: analysisEvidence.ownershipInference,
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
