import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeProjectSourceTexts,
  buildModuleFacts,
  buildProjectBindingResolution,
  buildRenderModel,
  summarizeClassNameExpression,
  toAbstractClassSet,
} from "../../dist/static-analysis-engine.js";
import { buildFactGraph } from "../../dist/static-analysis-engine/pipeline/fact-graph/buildFactGraph.js";
import { buildLanguageFrontends } from "../../dist/static-analysis-engine/pipeline/language-frontends/buildLanguageFrontends.js";
import { toClassExpressionSummary } from "../../dist/static-analysis-engine/pipeline/symbolic-evaluation/adapters/classExpressionSummary.js";
import { createLegacyAstExpressionStore } from "../../dist/static-analysis-engine/pipeline/symbolic-evaluation/adapters/legacyAstExpressionStore.js";
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
  const { graph, parsedFiles } = await buildFixtureAnalysis();
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
    legacy: {
      parsedFiles,
    },
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

test("symbolic evaluation uses the legacy AST store for current common class cases", async () => {
  const { graph, parsedFiles } = await buildFixtureAnalysis([
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
  const legacyStore = createLegacyAstExpressionStore({ parsedFiles });
  const result = evaluateSymbolicExpressions({
    graph,
    legacy: {
      parsedFiles,
    },
  });

  assert.equal(
    result.evaluatedExpressions.meta.evaluatedClassExpressionCount,
    graph.nodes.classExpressionSites.length,
  );
  assert.deepEqual(result.evaluatedExpressions.diagnostics, []);

  for (const site of graph.nodes.classExpressionSites) {
    const match = legacyStore.getExpressionForSite(site);
    assert.ok(match, `expected legacy AST match for ${site.id}`);

    const expected = toComparableClassSet(
      toAbstractClassSet(summarizeClassNameExpression(match.expression), site.location),
    );
    const expressionId = result.evaluatedExpressions.indexes.classExpressionIdBySiteNodeId.get(
      site.id,
    );
    assert.ok(expressionId);
    const expression = result.evaluatedExpressions.indexes.classExpressionById.get(expressionId);

    assert.deepEqual(toComparableCanonicalTokens(expression), expected);
    assert.equal(expression.unsupported.length, expected.unknownDynamic ? 1 : 0);
  }
});

test("symbolic evaluation reports raw expression text mismatches from the legacy AST store", async () => {
  const { graph, parsedFiles } = await buildFixtureAnalysis();
  const firstSite = graph.nodes.classExpressionSites[0];
  const graphWithMismatchedRawText = {
    ...graph,
    nodes: {
      ...graph.nodes,
      classExpressionSites: [
        {
          ...firstSite,
          rawExpressionText: '"changed"',
        },
      ],
    },
  };

  const result = evaluateSymbolicExpressions({
    graph: graphWithMismatchedRawText,
    legacy: {
      parsedFiles,
    },
  });

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
        code: "legacy-expression-text-mismatch",
        classExpressionSiteNodeId: firstSite.id,
      },
    ],
  );
});

test("symbolic evaluation prefers legacy render-model summaries for bound class expressions", async () => {
  const { graph, parsedFiles, frontends } = await buildFixtureAnalysis([
    'import "./app.css";',
    'const localClass = "bound local";',
    "export function App() {",
    "  return <div className={localClass} />;",
    "}",
    "",
  ]);
  const moduleFacts = buildModuleFacts({
    source: frontends.source,
    stylesheetFilePaths: ["src/app.css"],
  });
  const symbolResolution = buildProjectBindingResolution({
    source: frontends.source,
    moduleFacts,
    includeTraces: false,
  });
  const renderModel = buildRenderModel({
    parsedFiles,
    moduleFacts,
    symbolResolution,
    includeTraces: false,
  });

  const result = evaluateSymbolicExpressions({
    graph,
    legacy: {
      parsedFiles,
      renderModelClassExpressionSummaries: renderModel.legacyClassExpressionSummaries,
    },
  });
  const expression = getOnlyExpression(result);

  assert.deepEqual(expression.tokens.map((token) => token.token).sort(), ["bound", "local"]);
  assert.deepEqual(result.evaluatedExpressions.diagnostics, []);
  assert.equal(
    expression.provenance[0].summary,
    "Evaluated class expression with legacy render-model adapter",
  );
});

test("symbolic evaluation preserves render-aware props, destructuring, and helpers", async () => {
  const { result } = await evaluateRenderAwareFixture([
    'import "./app.css";',
    'const localClass = "local-binding";',
    'function joinClasses(...values) { return values.filter(Boolean).join(" "); }',
    "function PropsObject(props) { return <div className={props.className} />; }",
    'function Helper({ className }) { return <div className={joinClasses("helper-base", className)} />; }',
    "export function App() {",
    "  return (",
    "    <>",
    "      <div className={localClass} />",
    '      <PropsObject className="props-object" />',
    '      <Helper className="helper-extra" />',
    "    </>",
    "  );",
    "}",
    "",
  ]);

  assertRenderAwareTokens(result, ["helper-base", "helper-extra", "local-binding", "props-object"]);
});

test("symbolic evaluation preserves imported and namespace render-model bindings", async () => {
  const { result } = await evaluateRenderAwareFixture(
    [
      'import "./app.css";',
      'import { importedClass, importedHelper } from "./tokens";',
      'import * as tokens from "./tokens";',
      "export function App() {",
      "  return (",
      "    <>",
      "      <div className={importedClass} />",
      "      <div className={importedHelper('helper-imported')} />",
      "      <div className={tokens.namespaceClass} />",
      "      <div className={tokens.namespaceHelper('helper-namespace')} />",
      "    </>",
      "  );",
      "}",
      "",
    ],
    {
      "src/tokens.ts": [
        'export const importedClass = "imported-class";',
        'export const namespaceClass = "namespace-class";',
        'export function importedHelper(extra) { return ["imported-helper", extra].join(" "); }',
        'export function namespaceHelper(extra) { return ["namespace-helper", extra].join(" "); }',
        "",
      ].join("\n"),
    },
  );

  assertRenderAwareTokens(result, [
    "helper-imported",
    "helper-namespace",
    "imported-class",
    "imported-helper",
    "namespace-class",
    "namespace-helper",
  ]);
});

test("symbolic evaluation preserves finite string values and array find/join support", async () => {
  const { result } = await evaluateRenderAwareFixture([
    'import "./app.css";',
    "type Tone = 'tone-a' | 'tone-b';",
    "function Finite({ tone }: { tone: Tone }) { return <div className={`button ${tone}`} />; }",
    "export function App() {",
    "  const classes = ['array-a', false && 'array-b', 'array-c'];",
    "  return (",
    "    <>",
    "      <Finite />",
    "      <div className={classes.filter(Boolean).join(' ')} />",
    "      <div className={classes.find(Boolean)} />",
    "    </>",
    "  );",
    "}",
    "",
  ]);

  assertRenderAwareTokens(
    result,
    ["array-a", "array-c", "button"],
    ["array-b", "tone-a", "tone-b"],
  );
});

test("analyzeProjectSourceTexts produces internal symbolic evaluation facts when graph input exists", async () => {
  const { snapshot, frontends, factGraph } = await buildEngineFlowFixture([
    'const localClass = "internal-symbolic";',
    "export function App() { return <div className={localClass} />; }",
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

async function evaluateRenderAwareFixture(sourceText, extraSourceFiles = {}) {
  const projectBuilder = new TestProjectBuilder().withSourceFile(
    "src/App.tsx",
    sourceText.join("\n"),
  );
  for (const [filePath, text] of Object.entries(extraSourceFiles)) {
    projectBuilder.withSourceFile(filePath, text);
  }
  const project = await projectBuilder
    .withCssFile("src/app.css", ".placeholder { display: block; }\n")
    .build();

  try {
    const sourceFilePaths = ["src/App.tsx", ...Object.keys(extraSourceFiles)];
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths,
        cssFilePaths: ["src/app.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const graph = buildFactGraph({ snapshot, frontends }).graph;
    const parsedFiles = frontends.source.files.map((file) => file.legacy.parsedFile);
    const moduleFacts = buildModuleFacts({
      source: frontends.source,
      stylesheetFilePaths: ["src/app.css"],
    });
    const symbolResolution = buildProjectBindingResolution({
      source: frontends.source,
      moduleFacts,
      includeTraces: false,
    });
    const renderModel = buildRenderModel({
      parsedFiles,
      moduleFacts,
      symbolResolution,
      includeTraces: false,
    });

    return {
      graph,
      result: evaluateSymbolicExpressions({
        graph,
        legacy: {
          parsedFiles,
          renderModelClassExpressionSummaries: renderModel.legacyClassExpressionSummaries,
        },
      }),
      renderModel,
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

function toComparableClassSet(classSet) {
  return {
    definite: [...classSet.definite].sort(),
    possible: [...classSet.possible].sort(),
    unknownDynamic: classSet.unknownDynamic,
  };
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

function assertRenderAwareTokens(result, definiteTokens, possibleTokens = []) {
  const actual = toComparableClassSet({
    definite: unique(
      result.evaluatedExpressions.classExpressions.flatMap((expression) =>
        expression.tokens
          .filter((token) => token.presence === "always")
          .map((token) => token.token),
      ),
    ),
    possible: unique(
      result.evaluatedExpressions.classExpressions.flatMap((expression) =>
        expression.tokens
          .filter((token) => token.presence === "possible")
          .map((token) => token.token),
      ),
    ),
    unknownDynamic: result.evaluatedExpressions.classExpressions.some(
      (expression) =>
        expression.certainty.kind === "unknown" || expression.certainty.kind === "partial",
    ),
  });

  assert.deepEqual(actual.definite, [...definiteTokens].sort());
  assert.deepEqual(actual.possible, [...possibleTokens].sort());
  assert.deepEqual(result.evaluatedExpressions.diagnostics, []);
  assert.ok(
    result.evaluatedExpressions.classExpressions.some(
      (expression) =>
        expression.provenance[0].summary ===
        "Evaluated class expression with legacy render-model adapter",
    ),
  );
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
