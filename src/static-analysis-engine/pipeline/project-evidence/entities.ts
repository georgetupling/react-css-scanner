import {
  buildClassReferences,
  buildStaticallySkippedClassReferences,
} from "./entities/classReferences.js";
import {
  buildClassContexts,
  buildClassDefinitions,
  buildComponents,
  buildCssDeclarations,
  buildRenderSubtrees,
  buildSourceFiles,
  buildStylesheets,
  buildUnsupportedClassReferences,
} from "./entities/core.js";
import { buildCssModuleImports, buildCssModuleMemberReferences } from "./entities/cssModules.js";
import { buildSelectorBranches, buildSelectorQueries } from "./entities/selectors.js";
import type { ProjectEvidenceBuildInput, ProjectEvidenceBuilderIndexes } from "./analysisTypes.js";
import type { ProjectEvidenceEntities } from "./types.js";

export function buildProjectEvidenceEntities(input: {
  projectInput: ProjectEvidenceBuildInput;
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
  profileLogsEnabled?: boolean;
}): ProjectEvidenceEntities {
  const sourceFiles = measure("entities.sourceFiles", () =>
    buildSourceFiles(input.projectInput, input.indexes),
  );
  const renderGraph = input.projectInput.renderModel.renderGraph;
  const components = measure("entities.components", () =>
    buildComponents(renderGraph.nodes, input.indexes, input.projectInput),
  );
  const renderSubtrees = measure("entities.renderSubtrees", () =>
    buildRenderSubtrees(input.projectInput.renderModel, input.indexes),
  );
  const stylesheets = measure("entities.stylesheets", () =>
    buildStylesheets(input.projectInput, input.indexes),
  );
  const classDefinitions = measure("entities.classDefinitions", () =>
    buildClassDefinitions(input.projectInput, stylesheets, input.indexes),
  );
  const classContexts = measure("entities.classContexts", () =>
    buildClassContexts(input.projectInput, stylesheets, input.indexes),
  );
  const classReferences = measure("entities.classReferences", () =>
    buildClassReferences({
      renderModel: input.projectInput.renderModel,
      symbolicEvaluation: input.projectInput.symbolicEvaluation,
      factGraph: input.projectInput.factGraph,
      indexes: input.indexes,
      includeTraces: input.includeTraces,
    }),
  );
  const staticallySkippedClassReferences = measure(
    "entities.staticallySkippedClassReferences",
    () =>
      buildStaticallySkippedClassReferences({
        renderModel: input.projectInput.renderModel,
        symbolicEvaluation: input.projectInput.symbolicEvaluation,
        factGraph: input.projectInput.factGraph,
        indexes: input.indexes,
        includeTraces: input.includeTraces,
      }),
  );
  const unsupportedClassReferences = measure("entities.unsupportedClassReferences", () =>
    buildUnsupportedClassReferences(input.projectInput, input.indexes, input.includeTraces),
  );
  const selectorQueries = measure("entities.selectorQueries", () =>
    buildSelectorQueries({
      projectInput: input.projectInput,
      indexes: input.indexes,
      includeTraces: input.includeTraces,
      stylesheetIdByFactGraphNodeId: buildStylesheetIdByFactGraphNodeId(
        input.projectInput.factGraph,
        input.indexes,
      ),
    }),
  );
  const selectorBranches = measure("entities.selectorBranches", () =>
    buildSelectorBranches({
      projectInput: input.projectInput,
      selectorQueries,
      indexes: input.indexes,
      includeTraces: input.includeTraces,
    }),
  );
  const cssDeclarations = measure("entities.cssDeclarations", () =>
    buildCssDeclarations({
      projectInput: input.projectInput,
      stylesheets,
      selectorBranches,
    }),
  );
  const cssModuleImports = measure("entities.cssModuleImports", () =>
    buildCssModuleImports(input.projectInput, input.indexes),
  );
  const {
    aliases: cssModuleAliases,
    destructuredBindings: cssModuleDestructuredBindings,
    memberReferences: cssModuleMemberReferences,
    diagnostics: cssModuleReferenceDiagnostics,
  } = measure("entities.cssModuleMemberReferences", () =>
    buildCssModuleMemberReferences({
      projectInput: input.projectInput,
      imports: cssModuleImports,
      indexes: input.indexes,
      includeTraces: input.includeTraces,
    }),
  );

  return {
    sourceFiles,
    stylesheets,
    components,
    renderSubtrees,
    classDefinitions,
    classContexts,
    classReferences,
    staticallySkippedClassReferences,
    selectorQueries,
    selectorBranches,
    cssDeclarations,
    unsupportedClassReferences,
    cssModuleImports,
    cssModuleAliases,
    cssModuleDestructuredBindings,
    cssModuleMemberReferences,
    cssModuleReferenceDiagnostics,
  };

  function measure<T>(label: string, run: () => T): T {
    const start = performance.now();
    const result = run();
    if (input.profileLogsEnabled) {
      console.error(
        `[profile:project-evidence] ${label}: ${(performance.now() - start).toFixed(1)}ms`,
      );
    }
    return result;
  }
}

function buildStylesheetIdByFactGraphNodeId(
  factGraph: ProjectEvidenceBuildInput["factGraph"],
  indexes: ProjectEvidenceBuilderIndexes,
): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const stylesheet of factGraph?.graph.nodes.stylesheets ?? []) {
    if (!stylesheet.filePath) {
      continue;
    }

    const stylesheetId = indexes.stylesheetIdByPath.get(stylesheet.filePath.replace(/\\/g, "/"));
    if (stylesheetId) {
      mapping.set(stylesheet.id, stylesheetId);
    }
  }
  return mapping;
}
