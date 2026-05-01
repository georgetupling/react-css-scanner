import {
  buildProjectEvidence,
  buildProjectEvidenceEntities,
  buildProjectEvidenceRelations,
  createEmptyIndexes,
  indexEntities,
  type ProjectEvidenceBuildInput,
} from "../../pipeline/project-evidence/index.js";
import type { ProjectEvidenceStageResult } from "./types.js";

export function runProjectEvidenceStage(input: {
  projectInput: Omit<ProjectEvidenceBuildInput, "cssModuleLocalsConvention" | "includeTraces">;
  options?: {
    includeTraces?: boolean;
    cssModuleLocalsConvention?: ProjectEvidenceBuildInput["cssModuleLocalsConvention"];
  };
}): ProjectEvidenceStageResult {
  const includeTraces = input.options?.includeTraces ?? true;
  const indexes = createEmptyIndexes();
  const projectInput: ProjectEvidenceBuildInput = {
    ...input.projectInput,
    cssModuleLocalsConvention: input.options?.cssModuleLocalsConvention,
    includeTraces,
  };
  const entities = buildProjectEvidenceEntities({
    projectInput,
    indexes,
    includeTraces,
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
    unsupportedClassReferences,
    cssModuleImports,
    cssModuleAliases,
    cssModuleDestructuredBindings,
    cssModuleMemberReferences,
    cssModuleReferenceDiagnostics,
  } = entities;

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

  return {
    projectEvidence: buildProjectEvidence({
      entities,
      relations: buildProjectEvidenceRelations({
        projectInput,
        entities,
        indexes,
        includeTraces,
      }),
    }),
  };
}
