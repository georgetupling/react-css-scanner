import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModuleFacts,
  buildProjectBindingResolution,
  graphToReactRenderSyntaxInputs,
} from "../../dist/static-analysis-engine.js";
import { buildFactGraph } from "../../dist/static-analysis-engine/pipeline/fact-graph/buildFactGraph.js";
import { buildLanguageFrontends } from "../../dist/static-analysis-engine/pipeline/language-frontends/buildLanguageFrontends.js";
import { buildRenderModel } from "../../dist/static-analysis-engine/pipeline/render-model/buildRenderModel.js";
import { collectRenderRegionsFromSubtrees } from "../../dist/static-analysis-engine/pipeline/render-model/render-ir/collectRenderRegionsFromSubtrees.js";
import { buildRenderStructure } from "../../dist/static-analysis-engine/pipeline/render-structure/buildRenderStructure.js";
import { evaluateSymbolicExpressions } from "../../dist/static-analysis-engine/pipeline/symbolic-evaluation/evaluateSymbolicExpressions.js";
import { buildProjectSnapshot } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/buildProjectSnapshot.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

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

test("render structure projects the current render model into the stage 5 model", async () => {
  const fixture = await buildProjectionFixture();
  const symbolicEvaluation = evaluateSymbolicExpressions({
    graph: fixture.graph,
    cssModuleBindingResolution: fixture.symbolResolution,
  });
  const legacyModel = buildRenderModel({
    parsedFiles: fixture.parsedFiles,
    reactRenderSyntax: graphToReactRenderSyntaxInputs(fixture.graph),
    symbolResolution: fixture.symbolResolution,
    moduleFacts: fixture.moduleFacts,
    includeTraces: true,
  });
  const result = buildRenderStructure({
    graph: fixture.graph,
    symbolicEvaluation,
    options: {
      includeTraces: true,
    },
    legacy: {
      parsedFiles: fixture.parsedFiles,
      moduleFacts: fixture.moduleFacts,
      symbolResolution: fixture.symbolResolution,
    },
  });

  assert.equal(
    result.renderModel.components.length,
    result.renderModel.componentBoundaries.filter(
      (boundary) => boundary.boundaryKind === "component-root",
    ).length,
  );
  assert.equal(
    result.renderModel.componentBoundaries.filter(
      (boundary) => boundary.boundaryKind === "component-root",
    ).length,
    legacyModel.renderSubtrees.length,
  );
  assert.equal(
    result.renderModel.componentBoundaries.filter(
      (boundary) => boundary.boundaryKind === "expanded-component-reference",
    ).length,
    countLegacyExpandedComponentBoundaries(legacyModel.renderSubtrees),
  );
  assert.equal(
    result.renderModel.componentBoundaries.filter(
      (boundary) => boundary.boundaryKind === "unresolved-component-reference",
    ).length,
    countLegacyUnresolvedComponentBoundaries(legacyModel.renderSubtrees),
  );
  assert.equal(result.renderModel.elements.length, countLegacyElements(legacyModel.renderSubtrees));
  assert.equal(result.renderModel.renderGraph.nodes.length, result.renderModel.components.length);
  assert.equal(
    result.renderModel.renderGraph.edges.length,
    countLegacyExpandedComponentBoundaries(legacyModel.renderSubtrees) +
      countLegacyUnresolvedComponentBoundaries(legacyModel.renderSubtrees),
  );
  assert.ok(
    result.renderModel.renderGraph.edges.every((edge) => edge.traversal === "render-structure"),
  );
  assert.equal(
    result.renderModel.renderGraph.edges.filter((edge) => edge.resolution === "resolved").length,
    countLegacyExpandedComponentBoundaries(legacyModel.renderSubtrees),
  );
  assert.equal(
    result.renderModel.renderGraph.edges.filter((edge) => edge.resolution === "unresolved").length,
    countLegacyUnresolvedComponentBoundaries(legacyModel.renderSubtrees),
  );
  assert.equal(
    result.renderModel.renderRegions.length,
    collectRenderRegionsFromSubtrees(legacyModel.renderSubtrees).length +
      countLegacyUnresolvedComponentBoundaries(legacyModel.renderSubtrees),
  );
  assert.ok(
    result.renderModel.renderRegions.some((region) => region.regionKind === "unknown-barrier"),
  );
  assert.ok(
    result.renderModel.placementConditions.some(
      (condition) => condition.kind === "unknown-barrier",
    ),
  );
});

test("render structure builds emission sites from legacy render classes and stage 4 facts", async () => {
  const fixture = await buildProjectionFixture();
  const symbolicEvaluation = evaluateSymbolicExpressions({
    graph: fixture.graph,
    cssModuleBindingResolution: fixture.symbolResolution,
  });
  const legacyModel = buildRenderModel({
    parsedFiles: fixture.parsedFiles,
    reactRenderSyntax: graphToReactRenderSyntaxInputs(fixture.graph),
    symbolResolution: fixture.symbolResolution,
    moduleFacts: fixture.moduleFacts,
    includeTraces: true,
  });
  const result = buildRenderStructure({
    graph: fixture.graph,
    symbolicEvaluation,
    options: {
      includeTraces: true,
    },
    legacy: {
      parsedFiles: fixture.parsedFiles,
      moduleFacts: fixture.moduleFacts,
      symbolResolution: fixture.symbolResolution,
    },
  });
  const expressionsById = new Map(
    symbolicEvaluation.evaluatedExpressions.classExpressions.map((expression) => [
      expression.id,
      expression,
    ]),
  );
  const appComponentNodeId = componentNodeIdByName(fixture.graph, "App");
  const childComponentNodeId = componentNodeIdByName(fixture.graph, "Child");

  assert.equal(
    result.renderModel.emissionSites.length,
    countLegacyClassReferences(legacyModel.renderSubtrees),
  );

  for (const emissionSite of result.renderModel.emissionSites) {
    const expression = expressionsById.get(emissionSite.classExpressionId);
    assert.ok(expression);
    assert.equal(emissionSite.classExpressionSiteNodeId, expression.classExpressionSiteNodeId);
    assert.deepEqual(
      emissionSite.tokens.map((token) => token.token).sort(),
      expression.tokens.map((token) => token.token).sort(),
    );
    assert.deepEqual(emissionSite.emissionVariants, expression.emissionVariants);
    assert.deepEqual(
      emissionSite.tokenProvenance.map((provenance) => ({
        token: provenance.token,
        sourceClassExpressionSiteNodeId: provenance.sourceClassExpressionSiteNodeId,
        sourceExpressionId: provenance.sourceExpressionId,
        emittedByComponentNodeId: provenance.emittedByComponentNodeId,
        suppliedByComponentNodeId: provenance.suppliedByComponentNodeId,
      })),
      emissionSite.tokens.map((token) => ({
        token: token.token,
        sourceClassExpressionSiteNodeId: expression.classExpressionSiteNodeId,
        sourceExpressionId: expression.id,
        emittedByComponentNodeId: emissionSite.emittingComponentNodeId,
        suppliedByComponentNodeId: emissionSite.suppliedByComponentNodeId,
      })),
    );

    if (emissionSite.elementId) {
      assert.ok(
        result.renderModel.indexes.emissionSiteIdsByElementId
          .get(emissionSite.elementId)
          ?.includes(emissionSite.id),
      );
    }
  }

  const appEmission = findEmissionByToken(result.renderModel.emissionSites, "app");
  assert.equal(appEmission.emittingComponentNodeId, appComponentNodeId);
  assert.equal(appEmission.suppliedByComponentNodeId, appComponentNodeId);

  const childEmissions = result.renderModel.emissionSites.filter((emissionSite) =>
    emissionSite.tokens.some((token) => token.token === "child"),
  );
  assert.ok(childEmissions.length > 0);
  assert.ok(
    childEmissions.every(
      (emissionSite) =>
        emissionSite.emittingComponentNodeId === childComponentNodeId &&
        emissionSite.suppliedByComponentNodeId === childComponentNodeId,
    ),
  );

  const missingEmission = findEmissionByToken(result.renderModel.emissionSites, "missing");
  assert.equal(missingEmission.emissionKind, "unresolved-component-class-prop");
  assert.equal(missingEmission.emittingComponentNodeId, appComponentNodeId);
  assert.equal(missingEmission.suppliedByComponentNodeId, appComponentNodeId);
});

test("render structure legacy projection is deterministic across repeated runs", async () => {
  const fixture = await buildProjectionFixture();
  const symbolicEvaluation = evaluateSymbolicExpressions({
    graph: fixture.graph,
    cssModuleBindingResolution: fixture.symbolResolution,
  });
  const input = {
    graph: fixture.graph,
    symbolicEvaluation,
    legacy: {
      parsedFiles: fixture.parsedFiles,
      moduleFacts: fixture.moduleFacts,
      symbolResolution: fixture.symbolResolution,
    },
  };
  const first = buildRenderStructure(input);
  const second = buildRenderStructure(input);

  assert.deepEqual(first.renderModel.elements, second.renderModel.elements);
  assert.deepEqual(first.renderModel.componentBoundaries, second.renderModel.componentBoundaries);
  assert.deepEqual(first.renderModel.renderGraph, second.renderModel.renderGraph);
  assert.deepEqual(first.renderModel.renderRegions, second.renderModel.renderRegions);
  assert.deepEqual(
    serializeIndexSizes(first.renderModel.indexes),
    serializeIndexSizes(second.renderModel.indexes),
  );
});

async function buildProjectionFixture() {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./app.css";',
        'function Child() { return <span className="child"><strong className="label" /></span>; }',
        "export function App() {",
        '  return <main className="app"><Child /><MissingWidget className="missing" /></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/app.css", ".app, .child, .label, .missing { display: block; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
        cssFilePaths: ["src/app.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const factGraph = buildFactGraph({ snapshot, frontends });
    const moduleFacts = buildModuleFacts({
      source: frontends.source,
      stylesheetFilePaths: ["src/app.css"],
    });
    const symbolResolution = buildProjectBindingResolution({
      source: frontends.source,
      moduleFacts,
      includeTraces: true,
    });

    return {
      graph: factGraph.graph,
      parsedFiles: frontends.source.files.map((file) => file.legacy.parsedFile),
      moduleFacts,
      symbolResolution,
    };
  } finally {
    await project.cleanup();
  }
}

function countLegacyElements(renderSubtrees) {
  return renderSubtrees.reduce((count, subtree) => count + countNodes(subtree.root, "element"), 0);
}

function countLegacyExpandedComponentBoundaries(renderSubtrees) {
  return renderSubtrees.reduce(
    (count, subtree) => count + countNodes(subtree.root, "expanded-component-reference"),
    0,
  );
}

function countLegacyUnresolvedComponentBoundaries(renderSubtrees) {
  return renderSubtrees.reduce(
    (count, subtree) => count + countNodes(subtree.root, "component-reference"),
    0,
  );
}

function countLegacyClassReferences(renderSubtrees) {
  return renderSubtrees.reduce(
    (count, subtree) => count + countClassReferencesInNode(subtree.root),
    0,
  );
}

function countClassReferencesInNode(node) {
  let count = node.className ? 1 : 0;

  if (node.kind === "element" || node.kind === "fragment") {
    return count + node.children.reduce((sum, child) => sum + countClassReferencesInNode(child), 0);
  }

  if (node.kind === "conditional") {
    return (
      count + countClassReferencesInNode(node.whenTrue) + countClassReferencesInNode(node.whenFalse)
    );
  }

  if (node.kind === "repeated-region") {
    return count + countClassReferencesInNode(node.template);
  }

  return count;
}

function findEmissionByToken(emissionSites, token) {
  const emissionSite = emissionSites.find((candidate) =>
    candidate.tokens.some((candidateToken) => candidateToken.token === token),
  );
  assert.ok(emissionSite);
  return emissionSite;
}

function componentNodeIdByName(graph, componentName) {
  const component = graph.nodes.components.find(
    (candidate) => candidate.componentName === componentName,
  );
  assert.ok(component);
  return component.id;
}

function countNodes(node, kind) {
  let count = 0;
  if (
    (kind === "expanded-component-reference" && node.expandedFromComponentReference) ||
    node.kind === kind
  ) {
    count += 1;
  }

  if (node.kind === "element" || node.kind === "fragment") {
    return count + node.children.reduce((sum, child) => sum + countNodes(child, kind), 0);
  }

  if (node.kind === "conditional") {
    return count + countNodes(node.whenTrue, kind) + countNodes(node.whenFalse, kind);
  }

  if (node.kind === "repeated-region") {
    return count + countNodes(node.template, kind);
  }

  return count;
}

function normalizeAnchor(anchor) {
  return {
    ...anchor,
    filePath: normalizeProjectPath(anchor.filePath),
  };
}

function normalizeProjectPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

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
