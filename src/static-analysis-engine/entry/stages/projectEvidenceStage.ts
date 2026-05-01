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
  projectInput: ProjectEvidenceBuildInput;
  includeTraces?: boolean;
}): ProjectEvidenceStageResult {
  const includeTraces = input.includeTraces ?? true;
  const indexes = createEmptyIndexes();
  const projectEvidence = buildProjectEvidence({
    entities: buildProjectEvidenceEntities({
      projectInput: input.projectInput,
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

  return {
    projectEvidence: buildProjectEvidence({
      entities: projectEvidence.entities,
      relations: buildProjectEvidenceRelations({
        projectInput: input.projectInput,
        entities: projectEvidence.entities,
        indexes,
        includeTraces,
      }),
    }),
  };
}
