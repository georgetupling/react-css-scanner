import type { ProjectEvidenceBuildInput, ProjectEvidenceBuilderIndexes } from "./analysisTypes.js";
import { buildProjectEvidence } from "./buildProjectEvidence.js";
import { buildProjectEvidenceEntities } from "./entities.js";
import { buildProjectEvidenceRelations } from "./relations.js";
import { createEmptyIndexes, indexEntities } from "./internal/indexes.js";
import type { ProjectEvidenceAssemblyResult } from "./types.js";

export type BuildProjectEvidenceAssemblyInput = {
  projectInput: Omit<ProjectEvidenceBuildInput, "cssModuleLocalsConvention" | "includeTraces">;
  options?: {
    includeTraces?: boolean;
    cssModuleLocalsConvention?: ProjectEvidenceBuildInput["cssModuleLocalsConvention"];
  };
};

export function buildProjectEvidenceAssembly(
  input: BuildProjectEvidenceAssemblyInput,
): ProjectEvidenceAssemblyResult {
  const logEnabled = process.env.SCAN_REACT_CSS_PROFILE_PROJECT_EVIDENCE === "1";
  const startedAt = performance.now();
  const includeTraces = input.options?.includeTraces ?? true;
  const indexes = createEmptyIndexes();
  const projectInput: ProjectEvidenceBuildInput = {
    ...input.projectInput,
    cssModuleLocalsConvention: input.options?.cssModuleLocalsConvention,
    includeTraces,
  };
  const entities = measure("entities.total", () =>
    buildProjectEvidenceEntities({
      projectInput,
      indexes,
      includeTraces,
      profileLogsEnabled: logEnabled,
    }),
  );
  measure("entities.indexing", () => indexProjectEvidenceEntities(entities, indexes));
  const relations = measure("relations.total", () =>
    buildProjectEvidenceRelations({
      projectInput,
      entities,
      indexes,
      includeTraces,
      profileLogsEnabled: logEnabled,
    }),
  );
  const assembled = measure("assembly.finalize", () =>
    buildProjectEvidence({
      entities,
      relations,
    }),
  );
  log("project-evidence.total", performance.now() - startedAt);
  return assembled;

  function measure<T>(label: string, run: () => T): T {
    const start = performance.now();
    const result = run();
    log(label, performance.now() - start);
    return result;
  }

  function log(label: string, durationMs: number): void {
    if (!logEnabled) {
      return;
    }

    console.error(`[profile:project-evidence] ${label}: ${durationMs.toFixed(1)}ms`);
  }
}

function indexProjectEvidenceEntities(
  entities: ReturnType<typeof buildProjectEvidenceEntities>,
  indexes: ProjectEvidenceBuilderIndexes,
): void {
  indexEntities({
    sourceFiles: entities.sourceFiles,
    stylesheets: entities.stylesheets,
    classReferences: entities.classReferences,
    staticallySkippedClassReferences: entities.staticallySkippedClassReferences,
    classDefinitions: entities.classDefinitions,
    classContexts: entities.classContexts,
    selectorQueries: entities.selectorQueries,
    selectorBranches: entities.selectorBranches,
    cssDeclarations: entities.cssDeclarations,
    components: entities.components,
    unsupportedClassReferences: entities.unsupportedClassReferences,
    cssModuleImports: entities.cssModuleImports,
    cssModuleAliases: entities.cssModuleAliases,
    cssModuleDestructuredBindings: entities.cssModuleDestructuredBindings,
    cssModuleMemberReferences: entities.cssModuleMemberReferences,
    cssModuleReferenceDiagnostics: entities.cssModuleReferenceDiagnostics,
    indexes,
  });
}
