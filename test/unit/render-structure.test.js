import assert from "node:assert/strict";
import test from "node:test";

import { buildFactGraph } from "../../dist/static-analysis-engine/pipeline/fact-graph/buildFactGraph.js";
import { buildLanguageFrontends } from "../../dist/static-analysis-engine/pipeline/language-frontends/buildLanguageFrontends.js";
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

test("render structure expands intrinsic elements in native mode", async () => {
  const fixture = await buildProjectionFixture();
  const symbolicEvaluation = evaluateSymbolicExpressions({
    graph: fixture.graph,
  });
  const result = buildRenderStructure({
    graph: fixture.graph,
    symbolicEvaluation,
    options: {
      includeTraces: true,
    },
  });

  assert.equal(result.renderModel.components.length, fixture.graph.nodes.components.length);
  assert.ok(result.renderModel.componentBoundaries.length >= fixture.graph.nodes.components.length);
  assert.ok(result.renderModel.renderPaths.length >= fixture.graph.nodes.components.length);
  assert.ok(
    result.renderModel.renderPaths.filter((path) => path.terminalKind === "component-boundary")
      .length >= fixture.graph.nodes.components.length,
  );
  assert.ok(result.renderModel.renderRegions.length >= fixture.graph.nodes.components.length);
  assert.equal(result.renderModel.renderGraph.nodes.length, fixture.graph.nodes.components.length);
  assert.ok(result.renderModel.renderGraph.edges.length >= 0);

  assert.equal(
    result.renderModel.componentBoundaries.filter(
      (boundary) => boundary.boundaryKind === "component-root",
    ).length,
    fixture.graph.nodes.components.length,
  );
  assert.ok(
    result.renderModel.renderRegions.filter((region) => region.regionKind === "component-root")
      .length >= fixture.graph.nodes.components.length,
  );
  assert.ok(
    result.renderModel.renderPaths
      .filter((path) => path.terminalKind === "component-boundary")
      .every((path) => path.terminalKind === "component-boundary"),
  );

  assert.ok(result.renderModel.elements.length > 0);
  assert.ok(result.renderModel.elements.every((element) => element.tagName.length > 0));
  assert.ok(
    result.renderModel.elements.every((element) =>
      result.renderModel.indexes.elementById.has(element.id),
    ),
  );
  assert.ok(
    result.renderModel.elements.every((element) =>
      result.renderModel.indexes.renderPathById.has(element.renderPathId),
    ),
  );
  assert.ok(
    result.renderModel.elements.some(
      (element) =>
        element.childElementIds.length > 0 ||
        result.renderModel.indexes.ancestorElementIdsByElementId.get(element.id)?.length,
    ),
  );

  const classSiteCount = fixture.graph.nodes.classExpressionSites.length;
  const mappedOrDiagnosedSiteIds = new Set([
    ...result.renderModel.emissionSites.map((site) => site.classExpressionSiteNodeId),
    ...result.renderModel.diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.code === "missing-symbolic-class-expression" ||
          diagnostic.code === "unmodeled-class-expression-site",
      )
      .map((diagnostic) => diagnostic.classExpressionSiteNodeId)
      .filter(Boolean),
  ]);
  const mappedOrDiagnosedSiteCount = mappedOrDiagnosedSiteIds.size;
  assert.equal(mappedOrDiagnosedSiteCount, classSiteCount);
  assert.ok(
    result.renderModel.emissionSites.every((site) =>
      result.renderModel.indexes.emissionSiteById.has(site.id),
    ),
  );
  assert.ok(
    result.renderModel.emissionSites.every((site) =>
      result.renderModel.indexes.renderPathById.has(site.renderPathId),
    ),
  );
  assert.ok(result.renderModel.emissionSites.every((site) => site.classExpressionId.length > 0));
  assert.ok(
    result.renderModel.placementConditions.every(
      (condition) => condition.kind === "unknown-barrier",
    ),
  );

  for (const component of result.renderModel.components) {
    assert.equal(component.rootBoundaryIds.length, 1);
    assert.ok(result.renderModel.indexes.componentsById.has(component.id));
  }
  assert.ok(
    result.renderModel.componentBoundaries
      .filter((boundary) => boundary.boundaryKind === "component-root")
      .every((boundary) => boundary.rootElementIds.length > 0),
  );
  assert.ok(
    result.renderModel.renderRegions
      .filter((region) => region.regionKind === "component-root")
      .every((region) => region.childElementIds.length > 0),
  );
});

test("render structure projects the current render model into the stage 5 model", async () => {
  const fixture = await buildProjectionFixture();
  const symbolicEvaluation = evaluateSymbolicExpressions({
    graph: fixture.graph,
  });
  const result = buildRenderStructure({
    graph: fixture.graph,
    symbolicEvaluation,
    options: {
      includeTraces: true,
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
    2,
  );
  assert.equal(
    result.renderModel.componentBoundaries.filter(
      (boundary) => boundary.boundaryKind === "expanded-component-reference",
    ).length,
    1,
  );
  assert.equal(
    result.renderModel.componentBoundaries.filter(
      (boundary) => boundary.boundaryKind === "unresolved-component-reference",
    ).length,
    1,
  );
  assert.equal(result.renderModel.elements.length, 5);
  assert.equal(result.renderModel.renderGraph.nodes.length, result.renderModel.components.length);
  assert.equal(result.renderModel.renderGraph.edges.length, 2);
  assert.ok(
    result.renderModel.renderGraph.edges.every((edge) => edge.traversal === "render-structure"),
  );
  assert.equal(
    result.renderModel.renderGraph.edges.filter((edge) => edge.resolution === "resolved").length,
    1,
  );
  assert.equal(
    result.renderModel.renderGraph.edges.filter((edge) => edge.resolution === "unresolved").length,
    1,
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

test("render structure builds emission sites from stage 4 facts", async () => {
  const fixture = await buildProjectionFixture();
  const symbolicEvaluation = evaluateSymbolicExpressions({
    graph: fixture.graph,
  });
  const result = buildRenderStructure({
    graph: fixture.graph,
    symbolicEvaluation,
    options: {
      includeTraces: true,
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

  assert.equal(result.renderModel.emissionSites.length, 6);

  for (const emissionSite of result.renderModel.emissionSites) {
    const expression = expressionsById.get(emissionSite.classExpressionId);
    assert.ok(expression);
    assert.equal(emissionSite.classExpressionSiteNodeId, expression.classExpressionSiteNodeId);
    assert.deepEqual(
      emissionSite.tokens.map((token) => token.token).sort(),
      expression.tokens.map((token) => token.token).sort(),
    );
    for (const variant of expression.emissionVariants) {
      assert.ok(emissionSite.emissionVariants.some((candidate) => candidate.id === variant.id));
    }
    assert.deepEqual(
      emissionSite.tokenProvenance.map((provenance) => ({
        token: provenance.token,
        sourceClassExpressionSiteNodeId: provenance.sourceClassExpressionSiteNodeId,
        sourceExpressionId: provenance.sourceExpressionId,
        emittedByComponentNodeId: provenance.emittedByComponentNodeId,
        suppliedByComponentNodeId:
          provenance.suppliedByComponentNodeId ?? emissionSite.suppliedByComponentNodeId,
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

test("render structure instantiates parent-supplied external contributions during expansion", async () => {
  const fixture = await buildForwardedContributionFixture();
  const symbolicEvaluation = evaluateSymbolicExpressions({
    graph: fixture.graph,
  });
  const result = buildRenderStructure({
    graph: fixture.graph,
    symbolicEvaluation,
    options: {
      includeTraces: true,
    },
  });

  const appComponentNodeId = componentNodeIdByName(fixture.graph, "App");
  const childComponentNodeId = componentNodeIdByName(fixture.graph, "Child");
  const externalEmission = findEmissionByToken(result.renderModel.emissionSites, "from-parent");

  assert.equal(externalEmission.emittingComponentNodeId, childComponentNodeId);
  assert.equal(externalEmission.suppliedByComponentNodeId, appComponentNodeId);
  assert.ok(
    externalEmission.tokenProvenance.some(
      (provenance) =>
        provenance.token === "from-parent" &&
        provenance.emittedByComponentNodeId === childComponentNodeId &&
        provenance.suppliedByComponentNodeId === appComponentNodeId,
    ),
  );

  const staticChildEmission = findEmissionByToken(result.renderModel.emissionSites, "child-static");
  assert.equal(staticChildEmission.emittingComponentNodeId, childComponentNodeId);
  assert.equal(staticChildEmission.suppliedByComponentNodeId, childComponentNodeId);
});

test("render structure projection is deterministic across repeated runs", async () => {
  const fixture = await buildProjectionFixture();
  const symbolicEvaluation = evaluateSymbolicExpressions({
    graph: fixture.graph,
  });
  const input = {
    graph: fixture.graph,
    symbolicEvaluation,
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
    return {
      graph: factGraph.graph,
    };
  } finally {
    await project.cleanup();
  }
}

async function buildForwardedContributionFixture() {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./app.css";',
        "function Child({ className }) {",
        '  return <section className={className}><i className="child-static" /></section>;',
        "}",
        "export function App() {",
        '  return <main className="app"><Child className="from-parent" /></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/app.css", ".app, .child-static, .from-parent { display: block; }\n")
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
    return {
      graph: factGraph.graph,
    };
  } finally {
    await project.cleanup();
  }
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
