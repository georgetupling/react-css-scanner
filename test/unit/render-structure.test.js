import assert from "node:assert/strict";
import test from "node:test";

import { buildRenderStructure } from "../../dist/static-analysis-engine/pipeline/render-structure/buildRenderStructure.js";
import { evaluateSymbolicExpressions } from "../../dist/static-analysis-engine/pipeline/symbolic-evaluation/evaluateSymbolicExpressions.js";

test("render structure returns an empty render model for an empty graph", () => {
  const graph = emptyFactGraph();
  const symbolicEvaluation = evaluateSymbolicExpressions({ graph });
  const result = buildRenderStructure({
    graph,
    symbolicEvaluation,
  });

  assert.equal(result.graph, graph);
  assert.equal(result.symbolicEvaluation, symbolicEvaluation);
  assert.deepEqual(result.renderModel.meta, {
    generatedAtStage: "render-structure",
    componentCount: 0,
    componentBoundaryCount: 0,
    elementCount: 0,
    emissionSiteCount: 0,
    renderPathCount: 0,
    placementConditionCount: 0,
    renderRegionCount: 0,
    diagnosticCount: 0,
  });
  assert.deepEqual(result.renderModel.components, []);
  assert.deepEqual(result.renderModel.componentBoundaries, []);
  assert.deepEqual(result.renderModel.elements, []);
  assert.deepEqual(result.renderModel.emissionSites, []);
  assert.deepEqual(result.renderModel.renderPaths, []);
  assert.deepEqual(result.renderModel.placementConditions, []);
  assert.deepEqual(result.renderModel.renderRegions, []);
  assert.deepEqual(result.renderModel.renderGraph, {
    nodes: [],
    edges: [],
  });
  assert.deepEqual(result.renderModel.diagnostics, []);
  assert.equal(result.renderModel.indexes.componentsById.size, 0);
  assert.equal(result.renderModel.indexes.componentBoundaryById.size, 0);
  assert.equal(result.renderModel.indexes.elementById.size, 0);
  assert.equal(result.renderModel.indexes.emissionSiteById.size, 0);
  assert.equal(result.renderModel.indexes.renderPathById.size, 0);
});

test("render structure empty model ids and indexes are deterministic", () => {
  const graph = emptyFactGraph();
  const symbolicEvaluation = evaluateSymbolicExpressions({ graph });
  const first = buildRenderStructure({ graph, symbolicEvaluation });
  const second = buildRenderStructure({ graph, symbolicEvaluation });

  assert.deepEqual(first.renderModel.meta, second.renderModel.meta);
  assert.deepEqual(first.renderModel.components, second.renderModel.components);
  assert.deepEqual(first.renderModel.componentBoundaries, second.renderModel.componentBoundaries);
  assert.deepEqual(first.renderModel.elements, second.renderModel.elements);
  assert.deepEqual(first.renderModel.emissionSites, second.renderModel.emissionSites);
  assert.deepEqual(first.renderModel.renderPaths, second.renderModel.renderPaths);
  assert.deepEqual(first.renderModel.placementConditions, second.renderModel.placementConditions);
  assert.deepEqual(first.renderModel.renderRegions, second.renderModel.renderRegions);
  assert.deepEqual(first.renderModel.renderGraph, second.renderModel.renderGraph);
  assert.deepEqual(first.renderModel.diagnostics, second.renderModel.diagnostics);
  assert.deepEqual(
    serializeIndexSizes(first.renderModel.indexes),
    serializeIndexSizes(second.renderModel.indexes),
  );
});

function serializeIndexSizes(indexes) {
  return Object.fromEntries(
    Object.entries(indexes)
      .map(([key, value]) => [key, value.size])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function emptyFactGraph() {
  return {
    meta: {
      rootDir: ".",
      sourceFileCount: 0,
      stylesheetCount: 0,
      htmlFileCount: 0,
      generatedAtStage: "fact-graph",
    },
    nodes: {
      all: [],
      modules: [],
      components: [],
      renderSites: [],
      elementTemplates: [],
      classExpressionSites: [],
      expressionSyntax: [],
      componentPropBindings: [],
      localValueBindings: [],
      helperDefinitions: [],
      stylesheets: [],
      ruleDefinitions: [],
      selectors: [],
      selectorBranches: [],
      ownerCandidates: [],
      files: [],
      externalResources: [],
    },
    edges: {
      all: [],
      imports: [],
      renders: [],
      contains: [],
      referencesClassExpression: [],
      definesSelector: [],
      originatesFromFile: [],
      belongsToOwnerCandidate: [],
    },
    indexes: {
      nodesById: new Map(),
      edgesById: new Map(),
      fileNodeIdByPath: new Map(),
      moduleNodeIdByFilePath: new Map(),
      stylesheetNodeIdByFilePath: new Map(),
      componentNodeIdByComponentKey: new Map(),
      componentNodeIdsByFilePath: new Map(),
      renderSiteNodeIdByRenderSiteKey: new Map(),
      renderSiteNodeIdsByComponentNodeId: new Map(),
      elementTemplateNodeIdByTemplateKey: new Map(),
      classExpressionSiteNodeIdBySiteKey: new Map(),
      classExpressionSiteNodeIdsByComponentNodeId: new Map(),
      expressionSyntaxNodeIdByExpressionId: new Map(),
      expressionSyntaxNodeIdsByFilePath: new Map(),
      componentPropBindingNodeIdByBindingKey: new Map(),
      componentPropBindingNodeIdByComponentNodeId: new Map(),
      localValueBindingNodeIdByBindingKey: new Map(),
      localValueBindingNodeIdsByOwnerNodeId: new Map(),
      helperDefinitionNodeIdByHelperKey: new Map(),
      helperDefinitionNodeIdsByOwnerNodeId: new Map(),
      ownerCandidateNodeIdsByOwnerKind: new Map(),
      ruleDefinitionNodeIdsByStylesheetNodeId: new Map(),
      selectorNodeIdsByStylesheetNodeId: new Map(),
      selectorBranchNodeIdsByStylesheetNodeId: new Map(),
      selectorBranchNodeIdsByRequiredClassName: new Map(),
    },
    diagnostics: [],
  };
}
