import { buildFactGraphIndexes } from "./indexes.js";
import {
  buildCssEdges,
  buildCssNodes,
  buildExpressionSyntaxNodes,
  buildFileNodes,
  buildModuleNodes,
  buildOriginatesFromFileEdges,
  buildOwnerCandidateSeeds,
  buildImportEdges,
  buildStylesheetNodes,
  buildReactSyntaxFacts,
} from "./builders/index.js";
import { sortEdges, sortNodes } from "./utils/sortGraphElements.js";
import type { FactGraphInput, FactGraphResult } from "./types.js";

export function buildFactGraph(input: FactGraphInput): FactGraphResult {
  const fileNodes = buildFileNodes(input);
  const moduleNodes = buildModuleNodes(input);
  const stylesheetNodes = buildStylesheetNodes(input);
  const cssNodes = buildCssNodes(input);
  const reactSyntaxFacts = buildReactSyntaxFacts(input);
  const expressionSyntaxNodes = buildExpressionSyntaxNodes(input);
  const ownerCandidateSeeds = buildOwnerCandidateSeeds({
    graphInput: input,
    components: reactSyntaxFacts.components,
    modules: moduleNodes,
    stylesheets: stylesheetNodes,
    files: fileNodes,
  });
  const importEdges = buildImportEdges({
    frontends: input.frontends,
    snapshotEdges: input.snapshot.edges,
    moduleNodes,
    stylesheetNodes,
  });

  const nodes = sortNodes([
    ...fileNodes,
    ...moduleNodes,
    ...reactSyntaxFacts.allNodes,
    ...expressionSyntaxNodes,
    ...stylesheetNodes,
    ...cssNodes.all,
    ...ownerCandidateSeeds.ownerCandidates,
    ...importEdges.externalResources,
  ]);
  const originatesFromFileEdges = buildOriginatesFromFileEdges({
    fileNodes,
    moduleNodes,
    stylesheetNodes,
  });
  const cssEdges = buildCssEdges({
    ruleDefinitions: cssNodes.ruleDefinitions,
    selectors: cssNodes.selectors,
    selectorBranches: cssNodes.selectorBranches,
  });
  const edges = sortEdges([
    ...originatesFromFileEdges,
    ...cssEdges.all,
    ...reactSyntaxFacts.allEdges,
    ...ownerCandidateSeeds.belongsToOwnerCandidate,
    ...importEdges.imports,
  ]);

  const { indexes, diagnostics } = buildFactGraphIndexes({ nodes, edges });

  return {
    snapshot: input.snapshot,
    frontends: input.frontends,
    graph: {
      meta: {
        rootDir: input.snapshot.rootDir,
        sourceFileCount: input.snapshot.files.sourceFiles.length,
        stylesheetCount: input.snapshot.files.stylesheets.length,
        htmlFileCount: input.snapshot.files.htmlFiles.length,
        generatedAtStage: "fact-graph",
      },
      nodes: {
        all: nodes,
        modules: moduleNodes,
        components: reactSyntaxFacts.components,
        renderSites: reactSyntaxFacts.renderSites,
        elementTemplates: reactSyntaxFacts.elementTemplates,
        classExpressionSites: reactSyntaxFacts.classExpressionSites,
        expressionSyntax: expressionSyntaxNodes,
        componentPropBindings: reactSyntaxFacts.componentPropBindings,
        localValueBindings: reactSyntaxFacts.localValueBindings,
        helperDefinitions: reactSyntaxFacts.helperDefinitions,
        stylesheets: stylesheetNodes,
        ruleDefinitions: cssNodes.ruleDefinitions,
        selectors: cssNodes.selectors,
        selectorBranches: cssNodes.selectorBranches,
        ownerCandidates: ownerCandidateSeeds.ownerCandidates,
        files: fileNodes,
        externalResources: importEdges.externalResources,
      },
      edges: {
        all: edges,
        imports: importEdges.imports,
        renders: reactSyntaxFacts.renders,
        contains: sortEdges([...cssEdges.contains, ...reactSyntaxFacts.contains]),
        referencesClassExpression: reactSyntaxFacts.referencesClassExpression,
        definesSelector: cssEdges.definesSelector,
        originatesFromFile: originatesFromFileEdges,
        belongsToOwnerCandidate: ownerCandidateSeeds.belongsToOwnerCandidate,
      },
      indexes,
      diagnostics,
    },
  };
}
