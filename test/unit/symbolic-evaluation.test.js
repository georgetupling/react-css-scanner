import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeProjectSourceTexts,
  buildModuleFacts,
  buildProjectBindingResolution,
} from "../../dist/static-analysis-engine.js";
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

test("symbolic evaluation gives every graph class-expression site a canonical expression", async () => {
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
    assert.ok(expression.sourceExpressionKind);
    assert.notEqual(expression.expressionKind, "unknown");
    assert.deepEqual(expression.unsupported, []);
    assert.equal(expression.traces.length, 1);
  }
});

test("symbolic evaluation reports missing expression syntax without dropping other sites", async () => {
  const { graph } = await buildFixtureAnalysis();
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

test("symbolic evaluation uses normalized graph expression syntax for current common class cases", async () => {
  const { graph } = await buildFixtureAnalysis([
    'import "./app.css";',
    "const active = true;",
    "function cx(...values) { return values.join(' '); }",
    "export function App() {",
    "  return (",
    "    <>",
    '      <div className="literal one" />',
    '      <div className={`template ${"two"}`} />',
    '      <div className={active ? "choice-a" : "choice-b"} />',
    '      <div className={active && "logical"} />',
    '      <div className={["array", active && "array-active"].join(" ")} />',
    '      <div className={cx("helper", { selected: active })} />',
    "      <div className={{ objectClass: active }} />",
    "    </>",
    "  );",
    "}",
    "",
  ]);
  const result = evaluateSymbolicExpressions({
    graph,
  });

  assert.equal(
    result.evaluatedExpressions.meta.evaluatedClassExpressionCount,
    graph.nodes.classExpressionSites.length,
  );
  assert.deepEqual(result.evaluatedExpressions.diagnostics, []);

  const expectedTokensByRawText = new Map([
    ['"literal one"', { definite: ["literal", "one"], possible: [], unknownDynamic: false }],
    ['`template ${"two"}`', { definite: ["template", "two"], possible: [], unknownDynamic: false }],
    [
      'active ? "choice-a" : "choice-b"',
      { definite: [], possible: ["choice-a", "choice-b"], unknownDynamic: false },
    ],
    ['active && "logical"', { definite: [], possible: ["logical"], unknownDynamic: false }],
    [
      '["array", active && "array-active"].join(" ")',
      { definite: ["array"], possible: ["array-active"], unknownDynamic: false },
    ],
    ['cx("helper", { selected: active })', { definite: [], possible: [], unknownDynamic: true }],
    ["{ objectClass: active }", { definite: [], possible: ["objectClass"], unknownDynamic: false }],
  ]);

  for (const site of graph.nodes.classExpressionSites) {
    const expected = expectedTokensByRawText.get(site.rawExpressionText);
    assert.ok(expected, `expected normalized graph syntax case for ${site.rawExpressionText}`);
    const expressionId = result.evaluatedExpressions.indexes.classExpressionIdBySiteNodeId.get(
      site.id,
    );
    assert.ok(expressionId);
    const expression = result.evaluatedExpressions.indexes.classExpressionById.get(expressionId);

    assert.deepEqual(toComparableCanonicalTokens(expression), expected);
    assert.equal(expression.unsupported.length, expected.unknownDynamic ? 1 : 0);
    assert.equal(
      expression.provenance[0].summary,
      "Evaluated class expression from normalized graph expression syntax",
    );
  }
});

test("symbolic evaluation preserves conditional branch alternatives canonically", async () => {
  const { graph } = await buildFixtureAnalysis([
    "const condition = true;",
    "export function App() {",
    '  return <div className={condition ? "a" : "b"} />;',
    "}",
    "",
  ]);

  const result = evaluateSymbolicExpressions({
    graph,
  });
  const expression = getOnlyExpression(result);
  const summary = toClassExpressionSummary(expression);
  const exclusiveGroupIds = unique(
    expression.tokens.map((token) => token.exclusiveGroupId).filter(Boolean),
  );

  assert.deepEqual(summary.classes.definite, []);
  assert.deepEqual(summary.classes.possible, ["a", "b"]);
  assert.equal(exclusiveGroupIds.length, 1);
  assert.deepEqual(
    expression.tokens.map((token) => ({
      token: token.token,
      presence: token.presence,
      hasBranchCondition: result.evaluatedExpressions.indexes.conditionById.has(token.conditionId),
    })),
    [
      { token: "a", presence: "possible", hasBranchCondition: true },
      { token: "b", presence: "possible", hasBranchCondition: true },
    ],
  );
});

test("symbolic evaluation preserves non-whitespace join separators as complete emissions", async () => {
  const { graph } = await buildFixtureAnalysis([
    "export function App() {",
    '  return <div className={["a", "b"].join("-")} />;',
    "}",
    "",
  ]);

  const result = evaluateSymbolicExpressions({
    graph,
  });
  const expression = getOnlyExpression(result);

  assert.deepEqual(
    expression.tokens.map((token) => token.token),
    ["a-b"],
  );
  assert.deepEqual(expression.emissionVariants, [
    {
      id: `${expression.id}:variant:0`,
      conditionId: `${expression.id}:condition:always`,
      tokens: ["a-b"],
      completeness: "complete",
      unknownDynamic: false,
    },
  ]);
});

test("symbolic evaluation keeps nullish fallback possible for unknown left operands", async () => {
  const { graph } = await buildFixtureAnalysis([
    "export function App(props) {",
    '  return <div className={props.className ?? "fallback"} />;',
    "}",
    "",
  ]);

  const result = evaluateSymbolicExpressions({
    graph,
  });
  const expression = getOnlyExpression(result);
  const summary = toClassExpressionSummary(expression);

  assert.deepEqual(summary.classes.definite, []);
  assert.deepEqual(summary.classes.possible, ["fallback"]);
  assert.equal(summary.classes.unknownDynamic, true);
  assert.deepEqual(toComparableCanonicalTokens(expression), {
    definite: [],
    possible: ["fallback"],
    unknownDynamic: true,
  });
});

test("symbolic evaluation promotes definitely truthy object map entries", async () => {
  const { graph } = await buildFixtureAnalysis([
    "const c = Math.random() > 0.5;",
    "export function App() {",
    "  return <div className={{ a: true, b: false, c }} />;",
    "}",
    "",
  ]);

  const result = evaluateSymbolicExpressions({
    graph,
  });
  const expression = getOnlyExpression(result);

  assert.deepEqual(toComparableCanonicalTokens(expression), {
    definite: ["a"],
    possible: ["c"],
    unknownDynamic: false,
  });
});

test("symbolic evaluation preserves runtime DOM exact class text", async () => {
  const { snapshot, frontends, factGraph } = await buildEngineFlowFixture([
    'import { EditorView as ProseMirrorView } from "prosemirror-view";',
    "const mount = document.createElement('div');",
    "const state = {};",
    "new ProseMirrorView(undefined, {",
    "  state,",
    "  attributes: {",
    '    class: "ProseMirror editor-shell",',
    "  },",
    "});",
    "",
  ]);
  const result = analyzeProjectSourceTexts({
    sourceFiles: frontends.source.files.map((file) => ({
      filePath: file.filePath,
      sourceText: file.sourceText,
    })),
    source: frontends.source,
    css: frontends.css,
    boundaries: snapshot.boundaries,
    resourceEdges: snapshot.edges,
    factGraph,
    includeTraces: false,
  });
  const runtimeExpression = result.symbolicEvaluation.evaluatedExpressions.classExpressions.find(
    (expression) => expression.classExpressionSiteKind === "runtime-dom-class",
  );

  assert.ok(runtimeExpression);
  assert.deepEqual(
    runtimeExpression.tokens.map((token) => token.token),
    ["ProseMirror", "editor-shell"],
  );
});

test("symbolic evaluation records CSS Module member access as a contribution", async () => {
  const { result } = await evaluateRenderAwareFixture(
    [
      'import styles from "./App.module.css";',
      "export function App() { return <div className={styles.root} />; }",
      "",
    ],
    {},
    {
      "src/App.module.css": ".root { color: red; }\n",
    },
  );
  const expression = getOnlyCssModuleExpression(result);

  assert.deepEqual(expression.tokens, [
    {
      id: `${expression.id}:token:0:root`,
      token: "root",
      tokenKind: "css-module-export",
      presence: "always",
      conditionId: `${expression.id}:condition:always`,
      sourceAnchor: expression.cssModuleContributions[0].sourceAnchor,
      confidence: "high",
      contributionId: expression.cssModuleContributions[0].id,
    },
  ]);
  assert.equal(expression.cssModuleContributions[0].exportName, "root");
  assert.equal(expression.cssModuleContributions[0].accessKind, "property");
});

test("symbolic evaluation preserves computed CSS Module member diagnostics", async () => {
  const { result } = await evaluateRenderAwareFixture(
    [
      'import styles from "./App.module.css";',
      'const name = "root";',
      "export function App() { return <div className={styles[name]} />; }",
      "",
    ],
    {},
    {
      "src/App.module.css": ".root { color: red; }\n",
    },
  );
  const expression = getOnlyCssModuleExpression(result);

  assert.deepEqual(expression.cssModuleContributions, []);
  assert.equal(expression.unsupported[0].kind, "unsupported-css-module-access");
  assert.equal(expression.unsupported[0].code, "computed-css-module-member");
});

test("symbolic evaluation records CSS Module destructured bindings as contributions", async () => {
  const { result } = await evaluateRenderAwareFixture(
    [
      'import styles from "./App.module.css";',
      "const { root } = styles;",
      "export function App() { return <div className={root} />; }",
      "",
    ],
    {},
    {
      "src/App.module.css": ".root { color: red; }\n",
    },
  );
  const expression = getOnlyCssModuleExpression(result);

  assert.equal(expression.cssModuleContributions[0].exportName, "root");
  assert.equal(expression.cssModuleContributions[0].accessKind, "destructured-binding");
});

test("analyzeProjectSourceTexts produces internal symbolic evaluation facts when graph input exists", async () => {
  const { snapshot, frontends, factGraph } = await buildEngineFlowFixture([
    'export function App() { return <div className="internal-symbolic" />; }',
    "",
  ]);
  const result = analyzeProjectSourceTexts({
    sourceFiles: frontends.source.files.map((file) => ({
      filePath: file.filePath,
      sourceText: file.sourceText,
    })),
    source: frontends.source,
    css: frontends.css,
    boundaries: snapshot.boundaries,
    resourceEdges: snapshot.edges,
    factGraph,
    includeTraces: false,
  });

  assert.ok(result.symbolicEvaluation);
  assert.equal(
    result.symbolicEvaluation.evaluatedExpressions.meta.evaluatedClassExpressionCount,
    1,
  );
  assert.deepEqual(
    result.symbolicEvaluation.evaluatedExpressions.classExpressions[0].tokens.map(
      (token) => token.token,
    ),
    ["internal-symbolic"],
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
  const { graph } = await buildFixtureAnalysis();
  return graph;
}

async function buildFixtureAnalysis(
  sourceText = [
    'import "./app.css";',
    'function Child() { return <span className="child" />; }',
    'export function App() { return <Child className="app" />; }',
    "",
  ],
) {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", sourceText.join("\n"))
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
    return {
      graph: buildFactGraph({ snapshot, frontends }).graph,
      parsedFiles: frontends.source.files.map((file) => file.legacy.parsedFile),
      frontends,
    };
  } finally {
    await project.cleanup();
  }
}

async function evaluateRenderAwareFixture(sourceText, extraSourceFiles = {}, extraCssFiles = {}) {
  const projectBuilder = new TestProjectBuilder().withSourceFile(
    "src/App.tsx",
    sourceText.join("\n"),
  );
  for (const [filePath, text] of Object.entries(extraSourceFiles)) {
    projectBuilder.withSourceFile(filePath, text);
  }
  for (const [filePath, text] of Object.entries(extraCssFiles)) {
    projectBuilder.withCssFile(filePath, text);
  }
  const project = await projectBuilder
    .withCssFile("src/app.css", ".placeholder { display: block; }\n")
    .build();

  try {
    const sourceFilePaths = ["src/App.tsx", ...Object.keys(extraSourceFiles)];
    const cssFilePaths = ["src/app.css", ...Object.keys(extraCssFiles)];
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths,
        cssFilePaths,
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const graph = buildFactGraph({ snapshot, frontends }).graph;
    const moduleFacts = buildModuleFacts({
      source: frontends.source,
      stylesheetFilePaths: cssFilePaths,
    });
    const symbolResolution = buildProjectBindingResolution({
      source: frontends.source,
      moduleFacts,
      includeTraces: false,
    });

    return {
      graph,
      result: evaluateSymbolicExpressions({
        graph,
        legacy: {
          symbolResolution,
        },
      }),
    };
  } finally {
    await project.cleanup();
  }
}

async function buildEngineFlowFixture(sourceText) {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", sourceText.join("\n"))
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
        cssFilePaths: [],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    return {
      snapshot,
      frontends,
      factGraph: buildFactGraph({ snapshot, frontends }),
    };
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

function toComparableCanonicalTokens(expression) {
  return {
    definite: expression.tokens
      .filter((token) => token.presence === "always")
      .map((token) => token.token)
      .sort(),
    possible: expression.tokens
      .filter((token) => token.presence === "possible")
      .map((token) => token.token)
      .sort(),
    unknownDynamic:
      expression.certainty.kind === "unknown" || expression.certainty.kind === "partial",
  };
}

function getOnlyExpression(result) {
  assert.equal(result.evaluatedExpressions.classExpressions.length, 1);
  return result.evaluatedExpressions.classExpressions[0];
}

function getOnlyCssModuleExpression(result) {
  const expressions = result.evaluatedExpressions.classExpressions.filter(
    (expression) =>
      expression.cssModuleContributions.length > 0 ||
      expression.unsupported.some((reason) => reason.kind === "unsupported-css-module-access"),
  );
  assert.ok(expressions.length > 0);
  return expressions[0];
}

function unique(values) {
  return [...new Set(values)];
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
