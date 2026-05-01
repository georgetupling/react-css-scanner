import type { ProjectAnalysis, ProjectAnalysisBuildInput } from "./types.js";
import {
  buildSourceFiles,
  buildComponents,
  buildRenderSubtrees,
  buildStylesheets,
  buildClassDefinitions,
  buildClassContexts,
  buildUnsupportedClassReferences,
} from "./entities/core.js";
import {
  buildClassReferences,
  buildStaticallySkippedClassReferences,
} from "./entities/classReferences.js";
import { buildSelectorQueries, buildSelectorBranches } from "./entities/selectors.js";
import {
  buildCssModuleImports,
  buildCssModuleMemberReferences,
  buildCssModuleMemberMatches,
} from "./entities/cssModules.js";
import {
  createEmptyIndexes,
  indexEntities,
  indexRelations,
  indexClassOwnership,
} from "./internal/indexes.js";
import { buildStylesheetReachability } from "./relations/stylesheetReachability.js";
import { buildReferenceMatches } from "./relations/referenceMatches.js";
import {
  buildProviderClassSatisfactions,
  buildSelectorMatches,
} from "./relations/providerAndSelectorMatches.js";
import { buildClassOwnership } from "./relations/classOwnership.js";
import { buildModuleImports, buildComponentRenders } from "./relations/moduleAndComponent.js";

export function buildProjectAnalysis(input: ProjectAnalysisBuildInput): ProjectAnalysis {
  const includeTraces = input.includeTraces ?? true;
  const indexes = createEmptyIndexes();
  const sourceFiles = buildSourceFiles(input, indexes);
  const renderGraph = input.renderModel.renderGraph;
  const components = buildComponents(renderGraph.nodes, indexes, input);
  const renderSubtrees = buildRenderSubtrees(input.renderModel, indexes);
  const stylesheets = buildStylesheets(input, indexes);
  const classDefinitions = buildClassDefinitions(input, stylesheets, indexes);
  const classContexts = buildClassContexts(input, stylesheets, indexes);
  const classReferences = buildClassReferences({
    renderModel: input.renderModel,
    symbolicEvaluation: input.symbolicEvaluation,
    factGraph: input.factGraph,
    indexes,
    includeTraces,
  });
  const staticallySkippedClassReferences = buildStaticallySkippedClassReferences({
    renderModel: input.renderModel,
    symbolicEvaluation: input.symbolicEvaluation,
    factGraph: input.factGraph,
    indexes,
    includeTraces,
  });
  const unsupportedClassReferences = buildUnsupportedClassReferences(input, indexes, includeTraces);
  const selectorQueries = buildSelectorQueries(
    input.selectorQueryResults,
    stylesheets,
    indexes,
    includeTraces,
  );
  const selectorBranches = buildSelectorBranches(selectorQueries);
  const cssModuleImports = buildCssModuleImports(input, indexes);
  const {
    aliases: cssModuleAliases,
    destructuredBindings: cssModuleDestructuredBindings,
    memberReferences: cssModuleMemberReferences,
    diagnostics: cssModuleReferenceDiagnostics,
  } = buildCssModuleMemberReferences({
    projectInput: input,
    imports: cssModuleImports,
    indexes,
    includeTraces,
  });
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
  const stylesheetReachability = buildStylesheetReachability(input, indexes, includeTraces);
  const referenceMatches = buildReferenceMatches({
    references: classReferences,
    definitions: classDefinitions,
    reachability: stylesheetReachability,
    indexes,
    includeTraces,
  });
  const providerClassSatisfactions = buildProviderClassSatisfactions({
    references: classReferences,
    input,
    includeTraces,
  });
  const selectorMatches = buildSelectorMatches(selectorQueries, includeTraces);
  const cssModuleMemberMatches = buildCssModuleMemberMatches({
    references: cssModuleMemberReferences,
    indexes,
    localsConvention: input.cssModuleLocalsConvention,
    includeTraces,
  });
  const classOwnership = buildClassOwnership({
    input,
    definitions: classDefinitions,
    references: classReferences,
    components,
    stylesheets,
    referenceMatches,
    indexes,
    includeTraces,
  });

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
      moduleImports: buildModuleImports(input, indexes),
      componentRenders: buildComponentRenders(renderGraph.edges, indexes, includeTraces),
      stylesheetReachability,
      referenceMatches,
      selectorMatches,
      providerClassSatisfactions,
      cssModuleMemberMatches,
    },
    indexes,
  };
}
