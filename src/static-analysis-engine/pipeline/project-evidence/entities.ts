import {
  buildClassReferences,
  buildStaticallySkippedClassReferences,
} from "./entities/classReferences.js";
import {
  buildClassContexts,
  buildClassDefinitions,
  buildComponents,
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
}): ProjectEvidenceEntities {
  const sourceFiles = buildSourceFiles(input.projectInput, input.indexes);
  const renderGraph = input.projectInput.renderModel.renderGraph;
  const components = buildComponents(renderGraph.nodes, input.indexes, input.projectInput);
  const renderSubtrees = buildRenderSubtrees(input.projectInput.renderModel, input.indexes);
  const stylesheets = buildStylesheets(input.projectInput, input.indexes);
  const classDefinitions = buildClassDefinitions(input.projectInput, stylesheets, input.indexes);
  const classContexts = buildClassContexts(input.projectInput, stylesheets, input.indexes);
  const classReferences = buildClassReferences({
    renderModel: input.projectInput.renderModel,
    symbolicEvaluation: input.projectInput.symbolicEvaluation,
    factGraph: input.projectInput.factGraph,
    indexes: input.indexes,
    includeTraces: input.includeTraces,
  });
  const staticallySkippedClassReferences = buildStaticallySkippedClassReferences({
    renderModel: input.projectInput.renderModel,
    symbolicEvaluation: input.projectInput.symbolicEvaluation,
    factGraph: input.projectInput.factGraph,
    indexes: input.indexes,
    includeTraces: input.includeTraces,
  });
  const unsupportedClassReferences = buildUnsupportedClassReferences(
    input.projectInput,
    input.indexes,
    input.includeTraces,
  );
  const selectorQueries = buildSelectorQueries({
    projectSelectorProjection: input.projectInput.projectSelectorProjection,
    indexes: input.indexes,
    includeTraces: input.includeTraces,
    stylesheetIdByFactGraphNodeId: buildStylesheetIdByFactGraphNodeId(
      input.projectInput.factGraph,
      input.indexes,
    ),
  });
  const selectorBranches = buildSelectorBranches({
    projectSelectorProjection: input.projectInput.projectSelectorProjection,
    selectorQueries,
    indexes: input.indexes,
    includeTraces: input.includeTraces,
  });
  const cssModuleImports = buildCssModuleImports(input.projectInput, input.indexes);
  const {
    aliases: cssModuleAliases,
    destructuredBindings: cssModuleDestructuredBindings,
    memberReferences: cssModuleMemberReferences,
    diagnostics: cssModuleReferenceDiagnostics,
  } = buildCssModuleMemberReferences({
    projectInput: input.projectInput,
    imports: cssModuleImports,
    indexes: input.indexes,
    includeTraces: input.includeTraces,
  });

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
    unsupportedClassReferences,
    cssModuleImports,
    cssModuleAliases,
    cssModuleDestructuredBindings,
    cssModuleMemberReferences,
    cssModuleReferenceDiagnostics,
  };
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
