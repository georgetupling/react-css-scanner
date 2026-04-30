import assert from "node:assert/strict";
import test from "node:test";

import { buildFactGraph } from "../../dist/static-analysis-engine/pipeline/fact-graph/buildFactGraph.js";
import { buildLanguageFrontends } from "../../dist/static-analysis-engine/pipeline/language-frontends/buildLanguageFrontends.js";
import { toClassExpressionSummary } from "../../dist/static-analysis-engine/pipeline/symbolic-evaluation/adapters/classExpressionSummary.js";
import { evaluateSymbolicExpressions } from "../../dist/static-analysis-engine/pipeline/symbolic-evaluation/evaluateSymbolicExpressions.js";
import { buildProjectSnapshot } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/buildProjectSnapshot.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("symbolic evaluation returns empty facts for an empty graph", () => {
  const result = evaluateSymbolicExpressions({
    graph: emptyFactGraph(),
  });

  assert.deepEqual(result.evaluatedExpressions.meta, {
    generatedAtStage: "symbolic-evaluation",
    classExpressionSiteCount: 0,
    evaluatedClassExpressionCount: 0,
    diagnosticCount: 0,
  });
  assert.deepEqual(result.evaluatedExpressions.classExpressions, []);
  assert.deepEqual(result.evaluatedExpressions.conditions, []);
  assert.deepEqual(result.evaluatedExpressions.diagnostics, []);
  assert.equal(result.evaluatedExpressions.indexes.classExpressionById.size, 0);
  assert.equal(result.evaluatedExpressions.indexes.classExpressionIdBySiteNodeId.size, 0);
});

test("symbolic evaluation gives every graph class-expression site a fallback canonical expression", async () => {
  const graph = await buildFixtureGraph();
  const result = evaluateSymbolicExpressions({
    graph,
    options: {
      includeTraces: true,
    },
  });

  assert.equal(
    result.evaluatedExpressions.meta.classExpressionSiteCount,
    graph.nodes.classExpressionSites.length,
  );
  assert.equal(
    result.evaluatedExpressions.meta.evaluatedClassExpressionCount,
    graph.nodes.classExpressionSites.length,
  );
  assert.deepEqual(result.evaluatedExpressions.diagnostics, []);

  for (const site of graph.nodes.classExpressionSites) {
    const expressionId = result.evaluatedExpressions.indexes.classExpressionIdBySiteNodeId.get(
      site.id,
    );
    assert.ok(expressionId);
    const expression = result.evaluatedExpressions.indexes.classExpressionById.get(expressionId);
    assert.equal(expression.classExpressionSiteNodeId, site.id);
    assert.equal(expression.expressionKind, "unknown");
    assert.equal(expression.certainty.kind, "unknown");
    assert.equal(expression.unsupported[0].code, "unsupported-expression-kind");
    assert.equal(expression.traces.length, 1);
  }
});

test("symbolic evaluation reports missing expression syntax without dropping other sites", async () => {
  const graph = await buildFixtureGraph();
  const firstSite = graph.nodes.classExpressionSites[0];
  const graphWithMissingSite = {
    ...graph,
    nodes: {
      ...graph.nodes,
      classExpressionSites: [
        firstSite,
        {
          ...firstSite,
          id: `${firstSite.id}:missing-expression`,
          classExpressionSiteKey: `${firstSite.classExpressionSiteKey}:missing-expression`,
          expressionNodeId: "expression-syntax:missing",
          expressionId: "expression-syntax:missing",
        },
      ],
    },
  };

  const result = evaluateSymbolicExpressions({
    graph: graphWithMissingSite,
  });

  assert.equal(result.evaluatedExpressions.meta.classExpressionSiteCount, 2);
  assert.equal(result.evaluatedExpressions.meta.evaluatedClassExpressionCount, 1);
  assert.deepEqual(
    result.evaluatedExpressions.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      classExpressionSiteNodeId: diagnostic.classExpressionSiteNodeId,
    })),
    [
      {
        severity: "warning",
        code: "missing-expression-syntax",
        classExpressionSiteNodeId: `${firstSite.id}:missing-expression`,
      },
    ],
  );
});

test("symbolic evaluation ids and indexes are deterministic across repeated runs", async () => {
  const graph = await buildFixtureGraph();
  const first = evaluateSymbolicExpressions({ graph });
  const second = evaluateSymbolicExpressions({ graph });

  assert.deepEqual(serializeEvaluatedExpressions(first), serializeEvaluatedExpressions(second));
});

test("symbolic evaluation reports duplicate evaluated expression ids", async () => {
  const graph = await buildFixtureGraph();
  const firstSite = graph.nodes.classExpressionSites[0];
  const duplicatedGraph = {
    ...graph,
    nodes: {
      ...graph.nodes,
      classExpressionSites: [firstSite, { ...firstSite }],
    },
  };

  const result = evaluateSymbolicExpressions({
    graph: duplicatedGraph,
  });

  assert.equal(result.evaluatedExpressions.meta.classExpressionSiteCount, 2);
  assert.equal(result.evaluatedExpressions.meta.evaluatedClassExpressionCount, 2);
  assert.equal(result.evaluatedExpressions.indexes.classExpressionById.size, 1);
  assert.deepEqual(
    result.evaluatedExpressions.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
    })),
    [
      {
        severity: "error",
        code: "duplicate-evaluated-expression-id",
        message: `Duplicate evaluated class expression id: canonical-class-expression:${firstSite.id}`,
      },
    ],
  );
});

test("symbolic evaluation projects canonical expressions to compatibility summaries", () => {
  const expression = canonicalExpression({
    tokens: [
      {
        id: "expr:token:0:button",
        token: "button",
        tokenKind: "global-class",
        presence: "always",
        conditionId: "always",
        sourceAnchor: sourceAnchor(),
        confidence: "high",
      },
      {
        id: "expr:token:1:active",
        token: "active",
        tokenKind: "global-class",
        presence: "possible",
        conditionId: "unknown",
        confidence: "medium",
      },
      {
        id: "expr:token:2:moduleRoot",
        token: "moduleRoot",
        tokenKind: "css-module-export",
        presence: "always",
        conditionId: "always",
        confidence: "high",
      },
    ],
  });

  const summary = toClassExpressionSummary(expression);

  assert.deepEqual(summary.value, {
    kind: "class-set",
    definite: ["button"],
    possible: ["active"],
    unknownDynamic: false,
    reason: "css-module-class-contribution",
  });
  assert.deepEqual(summary.classes.definite, ["button"]);
  assert.deepEqual(summary.classes.possible, ["active"]);
  assert.equal(summary.classes.unknownDynamic, false);
  assert.deepEqual(summary.classNameSourceAnchors, {
    button: sourceAnchor(),
  });
  assert.equal(summary.sourceText, '"button"');
});

test("symbolic evaluation compatibility summaries preserve unsupported uncertainty", () => {
  const expression = canonicalExpression({
    certainty: {
      kind: "unknown",
      summary: "no reliable token information",
    },
    unsupported: [
      {
        id: "expr:unsupported:0:unsupported-expression-kind",
        kind: "unsupported-syntax",
        code: "unsupported-expression-kind",
        message: "Unsupported expression",
        recoverability: "none",
        confidence: "low",
      },
    ],
  });

  const summary = toClassExpressionSummary(expression);

  assert.deepEqual(summary.value, {
    kind: "unknown",
    reason: "unsupported-expression-kind",
  });
  assert.deepEqual(summary.classes.definite, []);
  assert.deepEqual(summary.classes.possible, []);
  assert.equal(summary.classes.unknownDynamic, true);
});

async function buildFixtureGraph() {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./app.css";',
        'function Child() { return <span className="child" />; }',
        'export function App() { return <Child className="app" />; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/app.css", ".app, .child { display: block; }\n")
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
    return buildFactGraph({ snapshot, frontends }).graph;
  } finally {
    await project.cleanup();
  }
}

function emptyFactGraph() {
  return {
    meta: {
      rootDir: "",
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
    },
    diagnostics: [],
  };
}

function serializeEvaluatedExpressions(result) {
  const facts = result.evaluatedExpressions;
  return {
    meta: facts.meta,
    classExpressions: facts.classExpressions.map((expression) => ({
      id: expression.id,
      classExpressionSiteNodeId: expression.classExpressionSiteNodeId,
      sourceExpressionKind: expression.sourceExpressionKind,
      unsupported: expression.unsupported.map((reason) => ({
        id: reason.id,
        code: reason.code,
      })),
    })),
    diagnostics: facts.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      classExpressionSiteNodeId: diagnostic.classExpressionSiteNodeId,
      message: diagnostic.message,
    })),
    indexes: {
      classExpressionById: mapEntries(facts.indexes.classExpressionById).map(([key, value]) => [
        key,
        value.id,
      ]),
      classExpressionIdBySiteNodeId: mapEntries(facts.indexes.classExpressionIdBySiteNodeId),
      classExpressionIdsByFilePath: mapEntries(facts.indexes.classExpressionIdsByFilePath),
      classExpressionIdsByComponentNodeId: mapEntries(
        facts.indexes.classExpressionIdsByComponentNodeId,
      ),
      tokenAlternativeIdsByToken: mapEntries(facts.indexes.tokenAlternativeIdsByToken),
      unsupportedReasonIdsByCode: mapEntries(facts.indexes.unsupportedReasonIdsByCode),
    },
  };
}

function mapEntries(map) {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function canonicalExpression(overrides = {}) {
  return {
    id: "expr",
    classExpressionSiteNodeId: "class-expression-site:src/App.tsx:1:1",
    classExpressionSiteKind: "jsx-class",
    expressionNodeId: "expression:src/App.tsx:1:1",
    filePath: "src/App.tsx",
    location: sourceAnchor(),
    rawExpressionText: '"button"',
    expressionKind: "class-token-set",
    certainty: {
      kind: "exact",
      summary: "one complete token set",
    },
    confidence: "high",
    tokens: [],
    emissionVariants: [],
    externalContributions: [],
    cssModuleContributions: [
      {
        id: "expr:css-module:0:moduleRoot",
        localName: "styles",
        originLocalName: "styles",
        exportName: "moduleRoot",
        accessKind: "property",
        conditionId: "always",
        sourceAnchor: sourceAnchor(),
        confidence: "high",
        traces: [],
      },
    ],
    unsupported: [],
    tokenAnchors: {},
    provenance: [],
    traces: [],
    ...overrides,
  };
}

function sourceAnchor() {
  return {
    filePath: "src/App.tsx",
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 9,
  };
}
