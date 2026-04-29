import { buildFactGraphIndexes } from "./indexes.js";
import {
  buildCssEdges,
  buildCssNodes,
  buildFileNodes,
  buildModuleNodes,
  buildOriginatesFromFileEdges,
  buildStylesheetNodes,
} from "./builders/index.js";
import { sortEdges, sortNodes } from "./utils/sortGraphElements.js";
import type { FactGraphInput, FactGraphResult } from "./types.js";

export function buildFactGraph(input: FactGraphInput): FactGraphResult {
  const fileNodes = buildFileNodes(input);
  const moduleNodes = buildModuleNodes(input);
  const stylesheetNodes = buildStylesheetNodes(input);
  const cssNodes = buildCssNodes(input);

  const nodes = sortNodes([...fileNodes, ...moduleNodes, ...stylesheetNodes, ...cssNodes.all]);
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
  const edges = sortEdges([...originatesFromFileEdges, ...cssEdges.all]);

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
        components: [],
        renderSites: [],
        elementTemplates: [],
        classExpressionSites: [],
        stylesheets: stylesheetNodes,
        ruleDefinitions: cssNodes.ruleDefinitions,
        selectors: cssNodes.selectors,
        selectorBranches: cssNodes.selectorBranches,
        ownerCandidates: [],
        files: fileNodes,
        externalResources: [],
      },
      edges: {
        all: edges,
        imports: [],
        renders: [],
        contains: cssEdges.contains,
        referencesClassExpression: [],
        definesSelector: cssEdges.definesSelector,
        originatesFromFile: originatesFromFileEdges,
        belongsToOwnerCandidate: [],
      },
      indexes,
      diagnostics,
    },
  };
}
