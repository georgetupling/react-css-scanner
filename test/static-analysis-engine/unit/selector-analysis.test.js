import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeProjectSourceTexts,
  analyzeSourceText,
} from "../../../dist/static-analysis-engine.js";
import { analyzeSelectorQueries } from "../../../dist/static-analysis-engine/pipeline/selector-analysis/analyzeSelectorQueries.js";
import { buildParsedSelectorQueries } from "../../../dist/static-analysis-engine/pipeline/selector-analysis/buildParsedSelectorQueries.js";

test("static analysis engine answers same-file ancestor-descendant selector queries", () => {
  const result = analyzeSourceText({
    filePath: "src/TopicManagePage.tsx",
    sourceText: [
      "export function TopicManagePage() {",
      '  return <section className="topic-manage-page"><h1 className="topic-manage-page__title-skeleton" /></section>;',
      "}",
    ].join("\n"),
    selectorQueries: [".topic-manage-page .topic-manage-page__title-skeleton"],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.deepEqual(result.selectorQueryResults[0], {
    selectorText: ".topic-manage-page .topic-manage-page__title-skeleton",
    source: {
      kind: "direct-query",
    },
    constraint: {
      kind: "ancestor-descendant",
      ancestorClassName: "topic-manage-page",
      subjectClassName: "topic-manage-page__title-skeleton",
    },
    outcome: "match",
    status: "resolved",
    confidence: "high",
    reasons: [
      'found a rendered descendant with class "topic-manage-page__title-skeleton" under an ancestor with class "topic-manage-page"',
    ],
    decision: {
      status: "resolved",
      certainty: "definite",
      dimensions: {
        structure: "definite",
      },
      reasons: [
        'found a rendered descendant with class "topic-manage-page__title-skeleton" under an ancestor with class "topic-manage-page"',
      ],
      traces: [
        {
          traceId: "selector-match:ancestor-descendant:definite",
          category: "selector-match",
          summary:
            'found a rendered descendant with class "topic-manage-page__title-skeleton" under an ancestor with class "topic-manage-page"',
          anchor: undefined,
          children: [],
        },
      ],
    },
  });
});

test("static analysis engine preserves possible selector matches across bounded render branches", () => {
  const result = analyzeSourceText({
    filePath: "src/TopicManagePage.tsx",
    sourceText: [
      "export function TopicManagePage({ showTitle }: { showTitle: boolean }) {",
      '  return showTitle ? <section className="topic-manage-page"><h1 className="topic-manage-page__title-skeleton" /></section> : <section className="topic-manage-page" />;',
      "}",
    ].join("\n"),
    selectorQueries: [".topic-manage-page .topic-manage-page__title-skeleton"],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "possible-match");
  assert.equal(result.selectorQueryResults[0].status, "resolved");
  assert.equal(result.selectorQueryResults[0].confidence, "medium");
  assert.deepEqual(result.selectorQueryResults[0].source, {
    kind: "direct-query",
  });
});

test("static analysis engine marks unsupported selector queries explicitly", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="app-shell" />; }',
    selectorQueries: [".app-shell[role]"],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "possible-match");
  assert.equal(result.selectorQueryResults[0].status, "unsupported");
  assert.equal(result.selectorQueryResults[0].confidence, "low");
  assert.deepEqual(result.selectorQueryResults[0].source, {
    kind: "direct-query",
  });
  assert.deepEqual(result.selectorQueryResults[0].reasons, [
    "unsupported selector query: only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported",
    "unsupported selector shape: only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported",
  ]);
  assert.deepEqual(result.selectorQueryResults[0].decision, {
    status: "unsupported",
    certainty: "unknown",
    dimensions: {
      structure: "unsupported",
    },
    reasons: [
      "unsupported selector query: only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported",
      "unsupported selector shape: only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported",
    ],
    traces: [
      {
        traceId: "selector-match:unsupported-selector-shape",
        category: "selector-match",
        summary:
          "unsupported selector query: only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported",
        anchor: undefined,
        children: [
          {
            traceId: "selector-parsing:normalized-selector:unsupported",
            category: "selector-parsing",
            summary:
              "could not normalize selector branch into the supported bounded selector shape subset",
            children: [],
            metadata: {
              hasUnknownSemantics: false,
              hasSubjectModifiers: true,
              negativeClassNames: [],
            },
          },
        ],
        metadata: {
          selectorText: ".app-shell[role]",
        },
      },
    ],
  });
});

test("static analysis engine answers same-file parent-child selector queries", () => {
  const result = analyzeSourceText({
    filePath: "src/Toolbar.tsx",
    sourceText: [
      "export function Toolbar() {",
      '  return <div className="toolbar"><button className="toolbar__button" /></div>;',
      "}",
    ].join("\n"),
    selectorQueries: [".toolbar > .toolbar__button"],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.deepEqual(result.selectorQueryResults[0], {
    selectorText: ".toolbar > .toolbar__button",
    source: {
      kind: "direct-query",
    },
    constraint: {
      kind: "parent-child",
      parentClassName: "toolbar",
      childClassName: "toolbar__button",
    },
    outcome: "match",
    status: "resolved",
    confidence: "high",
    reasons: [
      'found a rendered child with class "toolbar__button" directly under a parent with class "toolbar"',
    ],
    decision: {
      status: "resolved",
      certainty: "definite",
      dimensions: {
        structure: "definite",
      },
      reasons: [
        'found a rendered child with class "toolbar__button" directly under a parent with class "toolbar"',
      ],
      traces: [
        {
          traceId: "selector-match:parent-child:definite",
          category: "selector-match",
          summary:
            'found a rendered child with class "toolbar__button" directly under a parent with class "toolbar"',
          anchor: undefined,
          children: [],
        },
      ],
    },
  });
});

test("static analysis engine distinguishes parent-child from general descendant selectors", () => {
  const result = analyzeSourceText({
    filePath: "src/Toolbar.tsx",
    sourceText: [
      "export function Toolbar() {",
      '  return <div className="toolbar"><span><button className="toolbar__button" /></span></div>;',
      "}",
    ].join("\n"),
    selectorQueries: [".toolbar > .toolbar__button", ".toolbar .toolbar__button"],
  });

  assert.equal(result.selectorQueryResults.length, 2);
  assert.equal(result.selectorQueryResults[0].outcome, "no-match-under-bounded-analysis");
  assert.equal(result.selectorQueryResults[0].status, "resolved");
  assert.equal(result.selectorQueryResults[0].confidence, "high");
  assert.deepEqual(result.selectorQueryResults[0].constraint, {
    kind: "parent-child",
    parentClassName: "toolbar",
    childClassName: "toolbar__button",
  });
  assert.equal(result.selectorQueryResults[1].outcome, "match");
  assert.equal(result.selectorQueryResults[1].status, "resolved");
  assert.equal(result.selectorQueryResults[1].confidence, "high");
  assert.deepEqual(result.selectorQueryResults[1].constraint, {
    kind: "ancestor-descendant",
    ancestorClassName: "toolbar",
    subjectClassName: "toolbar__button",
  });
});

test("static analysis engine answers same-file adjacent sibling selector queries", () => {
  const result = analyzeSourceText({
    filePath: "src/Toolbar.tsx",
    sourceText: [
      "export function Toolbar() {",
      '  return <div className="toolbar"><span className="toolbar__label" /><button className="toolbar__button" /></div>;',
      "}",
    ].join("\n"),
    selectorQueries: [".toolbar__label + .toolbar__button"],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.deepEqual(result.selectorQueryResults[0].constraint, {
    kind: "sibling",
    relation: "adjacent",
    leftClassName: "toolbar__label",
    rightClassName: "toolbar__button",
  });
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.equal(result.selectorQueryResults[0].status, "resolved");
  assert.equal(result.selectorQueryResults[0].confidence, "high");
});

test("static analysis engine distinguishes adjacent from general sibling selectors", () => {
  const result = analyzeSourceText({
    filePath: "src/Toolbar.tsx",
    sourceText: [
      "export function Toolbar() {",
      '  return <div className="toolbar"><span className="toolbar__label" /><em className="toolbar__separator" /><button className="toolbar__button" /></div>;',
      "}",
    ].join("\n"),
    selectorQueries: [".toolbar__label + .toolbar__button", ".toolbar__label ~ .toolbar__button"],
  });

  assert.equal(result.selectorQueryResults.length, 2);
  assert.equal(result.selectorQueryResults[0].outcome, "no-match-under-bounded-analysis");
  assert.deepEqual(result.selectorQueryResults[0].constraint, {
    kind: "sibling",
    relation: "adjacent",
    leftClassName: "toolbar__label",
    rightClassName: "toolbar__button",
  });
  assert.equal(result.selectorQueryResults[1].outcome, "match");
  assert.deepEqual(result.selectorQueryResults[1].constraint, {
    kind: "sibling",
    relation: "general",
    leftClassName: "toolbar__label",
    rightClassName: "toolbar__button",
  });
});

test("static analysis engine can derive selector queries from css text inputs", () => {
  const result = analyzeSourceText({
    filePath: "src/TopicManagePage.tsx",
    sourceText: [
      'import "./TopicManagePage.css";',
      "export function TopicManagePage() {",
      '  return <section className="topic-manage-page"><h1 className="topic-manage-page__title-skeleton" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/TopicManagePage.css",
        cssText: ".topic-manage-page .topic-manage-page__title-skeleton { width: 100%; }",
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.deepEqual(result.selectorQueryResults[0].source, {
    kind: "css-source",
    selectorAnchor: {
      filePath: "src/TopicManagePage.css",
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 54,
    },
  });
});

test("static analysis engine splits comma-separated css selectors into separate queries", () => {
  const result = analyzeSourceText({
    filePath: "src/TopicManagePage.tsx",
    sourceText: [
      'import "./TopicManagePage.css";',
      "export function TopicManagePage() {",
      '  return <section className="topic-manage-page"><h1 className="topic-manage-page__title-skeleton" /><div className="topic-manage-page__subtitle" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/TopicManagePage.css",
        cssText:
          ".topic-manage-page .topic-manage-page__title-skeleton, .topic-manage-page .topic-manage-page__subtitle { width: 100%; }",
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 2);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.equal(result.selectorQueryResults[1].outcome, "match");
  assert.deepEqual(result.selectorQueryResults[0].source, {
    kind: "css-source",
    selectorAnchor: {
      filePath: "src/TopicManagePage.css",
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 54,
    },
  });
  assert.deepEqual(result.selectorQueryResults[1].source, {
    kind: "css-source",
    selectorAnchor: {
      filePath: "src/TopicManagePage.css",
      startLine: 1,
      startColumn: 56,
      endLine: 1,
      endColumn: 103,
    },
  });
});

test("static analysis engine preserves css-derived selector anchors across multiple lines", () => {
  const result = analyzeSourceText({
    filePath: "src/TopicManagePage.tsx",
    sourceText: [
      'import "./TopicManagePage.css";',
      "export function TopicManagePage() {",
      '  return <section className="topic-manage-page"><h1 className="topic-manage-page__title-skeleton" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/TopicManagePage.css",
        cssText: [
          ".topic-manage-page .topic-manage-page__title-skeleton,",
          ".topic-manage-page .topic-manage-page__subtitle {",
          "  width: 100%;",
          "}",
        ].join("\n"),
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 2);
  assert.deepEqual(result.selectorQueryResults[0].source, {
    kind: "css-source",
    selectorAnchor: {
      filePath: "src/TopicManagePage.css",
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 54,
    },
  });
  assert.deepEqual(result.selectorQueryResults[1].source, {
    kind: "css-source",
    selectorAnchor: {
      filePath: "src/TopicManagePage.css",
      startLine: 2,
      startColumn: 1,
      endLine: 2,
      endColumn: 48,
    },
  });
});

test("static analysis engine preserves @media context on css-derived selectors", () => {
  const result = analyzeSourceText({
    filePath: "src/TopicManagePage.tsx",
    sourceText: [
      'import "./TopicManagePage.css";',
      "export function TopicManagePage() {",
      '  return <section className="topic-manage-page"><h1 className="topic-manage-page__title-skeleton" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/TopicManagePage.css",
        cssText: [
          "@media (min-width: 800px) {",
          "  .topic-manage-page .topic-manage-page__title-skeleton {",
          "    width: 100%;",
          "  }",
          "}",
        ].join("\n"),
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.deepEqual(result.selectorQueryResults[0].source, {
    kind: "css-source",
    selectorAnchor: {
      filePath: "src/TopicManagePage.css",
      startLine: 2,
      startColumn: 3,
      endLine: 2,
      endColumn: 56,
    },
    atRuleContext: [
      {
        kind: "media",
        queryText: "(min-width: 800px)",
      },
    ],
  });
});

test("static analysis engine reports css-derived selectors as unavailable when the stylesheet is not imported", () => {
  const result = analyzeSourceText({
    filePath: "src/TopicManagePage.tsx",
    sourceText: [
      "export function TopicManagePage() {",
      '  return <section className="topic-manage-page"><h1 className="topic-manage-page__title-skeleton" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/TopicManagePage.css",
        cssText: ".topic-manage-page .topic-manage-page__title-skeleton { width: 100%; }",
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "no-match-under-bounded-analysis");
  assert.equal(result.selectorQueryResults[0].status, "resolved");
  assert.equal(result.selectorQueryResults[0].confidence, "high");
  assert.deepEqual(result.selectorQueryResults[0].reachability, {
    kind: "css-source",
    cssFilePath: "src/TopicManagePage.css",
    availability: "unavailable",
    contexts: [],
    reasons: ["no analyzed source file directly imports this stylesheet"],
  });
});

test("static analysis engine propagates stylesheet availability through render graph contexts", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/LayoutShell.tsx",
        sourceText: [
          'import "./LayoutShell.css";',
          "export function LayoutShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="layout-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { LayoutShell } from "./LayoutShell";',
          "export function App() {",
          '  return <LayoutShell><h1 className="page-title" /></LayoutShell>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/LayoutShell.css",
        cssText: ".layout-shell .page-title { width: 100%; }",
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.equal(result.reachabilitySummary.stylesheets.length, 1);
  assert.equal(result.reachabilitySummary.stylesheets[0].availability, "definite");
  assert.deepEqual(
    result.reachabilitySummary.stylesheets[0].contexts.map((contextRecord) => ({
      context: contextRecord.context,
      availability: contextRecord.availability,
      reasons: contextRecord.reasons,
      derivations: contextRecord.derivations,
    })),
    [
      {
        context: {
          kind: "component",
          filePath: "src/App.tsx",
          componentName: "App",
        },
        availability: "definite",
        reasons: [
          "component can render LayoutShell from src/LayoutShell.tsx, which has definite stylesheet availability",
        ],
        derivations: [
          {
            kind: "whole-component-child-availability",
            toComponentName: "LayoutShell",
            toFilePath: "src/LayoutShell.tsx",
          },
        ],
      },
      {
        context: {
          kind: "component",
          filePath: "src/LayoutShell.tsx",
          componentName: "LayoutShell",
        },
        availability: "definite",
        reasons: ["component is declared in a source file that directly imports this stylesheet"],
        derivations: [{ kind: "whole-component-direct-import" }],
      },
      {
        context: {
          kind: "render-subtree-root",
          filePath: "src/App.tsx",
          componentName: "App",
          rootAnchor: {
            startLine: 3,
            startColumn: 11,
            endLine: 3,
            endColumn: 18,
          },
        },
        availability: "definite",
        reasons: [
          "component can render LayoutShell from src/LayoutShell.tsx, which has definite stylesheet availability",
        ],
        derivations: [
          {
            kind: "whole-component-child-availability",
            toComponentName: "LayoutShell",
            toFilePath: "src/LayoutShell.tsx",
          },
        ],
      },
      {
        context: {
          kind: "render-subtree-root",
          filePath: "src/LayoutShell.tsx",
          componentName: "LayoutShell",
          rootAnchor: {
            startLine: 3,
            startColumn: 11,
            endLine: 3,
            endColumn: 18,
          },
        },
        availability: "definite",
        reasons: ["component is declared in a source file that directly imports this stylesheet"],
        derivations: [{ kind: "whole-component-direct-import" }],
      },
      {
        context: {
          kind: "source-file",
          filePath: "src/LayoutShell.tsx",
        },
        availability: "definite",
        reasons: ["source file directly imports this stylesheet"],
        derivations: [{ kind: "source-file-direct-import" }],
      },
    ],
  );
  assert.deepEqual(result.reachabilitySummary.stylesheets[0].contexts[0].traces, [
    {
      traceId: "reachability-context:component:definite",
      category: "reachability",
      summary:
        "component can render LayoutShell from src/LayoutShell.tsx, which has definite stylesheet availability",
      children: [
        {
          traceId: "render-graph:edge:src/App.tsx:App:LayoutShell:definite:resolved",
          category: "render-graph",
          summary: "resolved render edge App -> LayoutShell",
          anchor: {
            filePath: "src/App.tsx",
            startLine: 3,
            startColumn: 11,
            endLine: 3,
            endColumn: 22,
          },
          children: [
            {
              traceId: "symbol-resolution:direct-export:src/LayoutShell.tsx:LayoutShell",
              category: "symbol-resolution",
              summary: "resolved export LayoutShell directly from src/LayoutShell.tsx",
              anchor: {
                filePath: "src/App.tsx",
                startLine: 1,
                startColumn: 10,
                endLine: 1,
                endColumn: 21,
              },
              children: [],
              metadata: {
                exportedName: "LayoutShell",
                filePath: "src/LayoutShell.tsx",
                resolution: "direct-export",
              },
            },
          ],
          metadata: {
            fromComponentName: "App",
            fromFilePath: "src/App.tsx",
            toComponentName: "LayoutShell",
            toFilePath: "src/LayoutShell.tsx",
            resolution: "resolved",
            renderPath: "definite",
            traversal: "direct-jsx",
          },
        },
      ],
      metadata: {
        contextKind: "component",
        availability: "definite",
        derivations: ["whole-component-child-availability:LayoutShell:src/LayoutShell.tsx"],
      },
    },
  ]);
});

test("static analysis engine preserves possible stylesheet availability across conditional render paths", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/LayoutShell.tsx",
        sourceText: [
          'import "./LayoutShell.css";',
          "export function LayoutShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="layout-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { LayoutShell } from "./LayoutShell";',
          "export function App({ showLayout }: { showLayout: boolean }) {",
          '  return showLayout ? <LayoutShell><h1 className="page-title" /></LayoutShell> : <main className="page-title" />;',
          "}",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/LayoutShell.css",
        cssText: ".layout-shell .page-title { width: 100%; }",
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "possible-match");
  assert.deepEqual(
    {
      ...result.selectorQueryResults[0].reachability,
      contexts: result.selectorQueryResults[0].reachability.contexts.map((contextRecord) => ({
        context: contextRecord.context,
        availability: contextRecord.availability,
        reasons: contextRecord.reasons,
        derivations: contextRecord.derivations,
      })),
      matchedContexts: result.selectorQueryResults[0].reachability.matchedContexts.map(
        (contextRecord) => ({
          context: contextRecord.context,
          availability: contextRecord.availability,
          reasons: contextRecord.reasons,
          derivations: contextRecord.derivations,
        }),
      ),
    },
    {
      kind: "css-source",
      cssFilePath: "src/LayoutShell.css",
      availability: "possible",
      contexts: [
        {
          context: {
            kind: "render-region",
            filePath: "src/App.tsx",
            componentName: "App",
            regionKind: "conditional-branch",
            path: [{ kind: "root" }, { kind: "conditional-branch", branch: "when-true" }],
            sourceAnchor: {
              startLine: 3,
              startColumn: 24,
              endLine: 3,
              endColumn: 35,
            },
          },
          availability: "possible",
          reasons: [
            "region can render LayoutShell from src/LayoutShell.tsx, which has stylesheet availability",
          ],
          derivations: [
            {
              kind: "placement-derived-region",
              toComponentName: "LayoutShell",
              toFilePath: "src/LayoutShell.tsx",
              renderPath: "possible",
            },
          ],
        },
      ],
      matchedContexts: [
        {
          context: {
            kind: "render-region",
            filePath: "src/App.tsx",
            componentName: "App",
            regionKind: "conditional-branch",
            path: [{ kind: "root" }, { kind: "conditional-branch", branch: "when-true" }],
            sourceAnchor: {
              startLine: 3,
              startColumn: 24,
              endLine: 3,
              endColumn: 35,
            },
          },
          availability: "possible",
          reasons: [
            "region can render LayoutShell from src/LayoutShell.tsx, which has stylesheet availability",
          ],
          derivations: [
            {
              kind: "placement-derived-region",
              toComponentName: "LayoutShell",
              toFilePath: "src/LayoutShell.tsx",
              renderPath: "possible",
            },
          ],
        },
      ],
      reasons: ["selector only matched within possible stylesheet-reachable render contexts"],
    },
  );
  assert.deepEqual(result.selectorQueryResults[0].reachability.contexts[0].traces, [
    {
      traceId: "reachability-context:render-region:possible",
      category: "reachability",
      summary:
        "region can render LayoutShell from src/LayoutShell.tsx, which has stylesheet availability",
      anchor: {
        filePath: "src/App.tsx",
        startLine: 3,
        startColumn: 24,
        endLine: 3,
        endColumn: 35,
      },
      children: [
        {
          traceId: "render-graph:edge:src/App.tsx:App:LayoutShell:possible:resolved",
          category: "render-graph",
          summary: "resolved render edge App -> LayoutShell on a possible render path",
          anchor: {
            filePath: "src/App.tsx",
            startLine: 3,
            startColumn: 24,
            endLine: 3,
            endColumn: 35,
          },
          children: [
            {
              traceId: "symbol-resolution:direct-export:src/LayoutShell.tsx:LayoutShell",
              category: "symbol-resolution",
              summary: "resolved export LayoutShell directly from src/LayoutShell.tsx",
              anchor: {
                filePath: "src/App.tsx",
                startLine: 1,
                startColumn: 10,
                endLine: 1,
                endColumn: 21,
              },
              children: [],
              metadata: {
                exportedName: "LayoutShell",
                filePath: "src/LayoutShell.tsx",
                resolution: "direct-export",
              },
            },
          ],
          metadata: {
            fromComponentName: "App",
            fromFilePath: "src/App.tsx",
            toComponentName: "LayoutShell",
            toFilePath: "src/LayoutShell.tsx",
            resolution: "resolved",
            renderPath: "possible",
            traversal: "direct-jsx",
          },
        },
      ],
      metadata: {
        contextKind: "render-region",
        availability: "possible",
        derivations: ["placement-derived-region:LayoutShell:src/LayoutShell.tsx:possible"],
      },
    },
  ]);
  assert.deepEqual(result.selectorQueryResults[0].decision, {
    status: "resolved",
    certainty: "possible",
    dimensions: {
      structure: "possible",
      reachability: "possible",
    },
    reasons: [
      'found a plausible ancestor-descendant match for "layout-shell page-title" on at least one bounded path',
    ],
    traces: [
      {
        traceId: "selector-match:ancestor-descendant:possible",
        category: "selector-match",
        summary:
          'found a plausible ancestor-descendant match for "layout-shell page-title" on at least one bounded path',
        anchor: {
          filePath: "src/LayoutShell.css",
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 26,
        },
        children: [],
      },
      {
        traceId: "selector-reachability:possible",
        category: "reachability",
        summary: "selector only matched within possible stylesheet-reachable render contexts",
        anchor: {
          filePath: "src/LayoutShell.css",
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 26,
        },
        children: [
          {
            traceId: "reachability-context:render-region:possible",
            category: "reachability",
            summary:
              "region can render LayoutShell from src/LayoutShell.tsx, which has stylesheet availability",
            anchor: {
              filePath: "src/App.tsx",
              startLine: 3,
              startColumn: 24,
              endLine: 3,
              endColumn: 35,
            },
            children: [
              {
                traceId: "render-graph:edge:src/App.tsx:App:LayoutShell:possible:resolved",
                category: "render-graph",
                summary: "resolved render edge App -> LayoutShell on a possible render path",
                anchor: {
                  filePath: "src/App.tsx",
                  startLine: 3,
                  startColumn: 24,
                  endLine: 3,
                  endColumn: 35,
                },
                children: [
                  {
                    traceId: "symbol-resolution:direct-export:src/LayoutShell.tsx:LayoutShell",
                    category: "symbol-resolution",
                    summary: "resolved export LayoutShell directly from src/LayoutShell.tsx",
                    anchor: {
                      filePath: "src/App.tsx",
                      startLine: 1,
                      startColumn: 10,
                      endLine: 1,
                      endColumn: 21,
                    },
                    children: [],
                    metadata: {
                      exportedName: "LayoutShell",
                      filePath: "src/LayoutShell.tsx",
                      resolution: "direct-export",
                    },
                  },
                ],
                metadata: {
                  fromComponentName: "App",
                  fromFilePath: "src/App.tsx",
                  toComponentName: "LayoutShell",
                  toFilePath: "src/LayoutShell.tsx",
                  resolution: "resolved",
                  renderPath: "possible",
                  traversal: "direct-jsx",
                },
              },
            ],
            metadata: {
              contextKind: "render-region",
              availability: "possible",
              derivations: ["placement-derived-region:LayoutShell:src/LayoutShell.tsx:possible"],
            },
          },
        ],
        metadata: {
          cssFilePath: "src/LayoutShell.css",
          matchedContextCount: 1,
          availability: "possible",
        },
      },
    ],
  });

  const appComponentContext = result.reachabilitySummary.stylesheets[0].contexts.find(
    (contextRecord) =>
      contextRecord.context.kind === "component" &&
      contextRecord.context.filePath === "src/App.tsx" &&
      contextRecord.context.componentName === "App",
  );
  assert.equal(appComponentContext, undefined);

  const branchRegions = result.reachabilitySummary.stylesheets[0].contexts.filter(
    (contextRecord) =>
      contextRecord.context.kind === "render-region" &&
      contextRecord.context.filePath === "src/App.tsx" &&
      contextRecord.context.componentName === "App",
  );
  assert.deepEqual(
    branchRegions.map((contextRecord) => ({
      context: contextRecord.context,
      availability: contextRecord.availability,
      reasons: contextRecord.reasons,
      derivations: contextRecord.derivations,
    })),
    [
      {
        context: {
          kind: "render-region",
          filePath: "src/App.tsx",
          componentName: "App",
          regionKind: "conditional-branch",
          path: [{ kind: "root" }, { kind: "conditional-branch", branch: "when-true" }],
          sourceAnchor: {
            startLine: 3,
            startColumn: 24,
            endLine: 3,
            endColumn: 35,
          },
        },
        availability: "possible",
        reasons: [
          "region can render LayoutShell from src/LayoutShell.tsx, which has stylesheet availability",
        ],
        derivations: [
          {
            kind: "placement-derived-region",
            toComponentName: "LayoutShell",
            toFilePath: "src/LayoutShell.tsx",
            renderPath: "possible",
          },
        ],
      },
    ],
  );
});

test("static analysis engine attaches propagated stylesheet availability to repeated template regions", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/ResultRow.tsx",
        sourceText: [
          'import "./ResultRow.css";',
          "export function ResultRow() {",
          '  return <li className="result-row" />;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { ResultRow } from "./ResultRow";',
          "export function App({ items }: { items: string[] }) {",
          '  return <ul className="results">{items.map(() => <ResultRow />)}</ul>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/ResultRow.css",
        cssText: ".result-row { color: red; }",
      },
    ],
  });

  const repeatedTemplateRegion = result.reachabilitySummary.stylesheets[0].contexts.find(
    (contextRecord) =>
      contextRecord.context.kind === "render-region" &&
      contextRecord.context.filePath === "src/App.tsx" &&
      contextRecord.context.componentName === "App" &&
      contextRecord.context.regionKind === "repeated-template",
  );

  assert.deepEqual(
    {
      context: repeatedTemplateRegion.context,
      availability: repeatedTemplateRegion.availability,
      reasons: repeatedTemplateRegion.reasons,
      derivations: repeatedTemplateRegion.derivations,
    },
    {
      context: {
        kind: "render-region",
        filePath: "src/App.tsx",
        componentName: "App",
        regionKind: "repeated-template",
        path: [
          { kind: "root" },
          { kind: "fragment-child", childIndex: 0 },
          { kind: "repeated-template" },
        ],
        sourceAnchor: {
          startLine: 3,
          startColumn: 52,
          endLine: 3,
          endColumn: 61,
        },
      },
      availability: "possible",
      reasons: [
        "region can render ResultRow from src/ResultRow.tsx, which has stylesheet availability",
      ],
      derivations: [
        {
          kind: "placement-derived-region",
          toComponentName: "ResultRow",
          toFilePath: "src/ResultRow.tsx",
          renderPath: "possible",
        },
      ],
    },
  );
  assert.deepEqual(repeatedTemplateRegion.traces, [
    {
      traceId: "reachability-context:render-region:possible",
      category: "reachability",
      summary:
        "region can render ResultRow from src/ResultRow.tsx, which has stylesheet availability",
      anchor: {
        filePath: "src/App.tsx",
        startLine: 3,
        startColumn: 52,
        endLine: 3,
        endColumn: 61,
      },
      children: [
        {
          traceId: "render-graph:edge:src/App.tsx:App:ResultRow:possible:resolved",
          category: "render-graph",
          summary: "resolved render edge App -> ResultRow on a possible render path",
          anchor: {
            filePath: "src/App.tsx",
            startLine: 3,
            startColumn: 52,
            endLine: 3,
            endColumn: 61,
          },
          children: [
            {
              traceId: "symbol-resolution:direct-export:src/ResultRow.tsx:ResultRow",
              category: "symbol-resolution",
              summary: "resolved export ResultRow directly from src/ResultRow.tsx",
              anchor: {
                filePath: "src/App.tsx",
                startLine: 1,
                startColumn: 10,
                endLine: 1,
                endColumn: 19,
              },
              children: [],
              metadata: {
                exportedName: "ResultRow",
                filePath: "src/ResultRow.tsx",
                resolution: "direct-export",
              },
            },
          ],
          metadata: {
            fromComponentName: "App",
            fromFilePath: "src/App.tsx",
            toComponentName: "ResultRow",
            toFilePath: "src/ResultRow.tsx",
            resolution: "resolved",
            renderPath: "possible",
            traversal: "direct-jsx",
          },
        },
      ],
      metadata: {
        contextKind: "render-region",
        availability: "possible",
        derivations: ["placement-derived-region:ResultRow:src/ResultRow.tsx:possible"],
      },
    },
  ]);
});

test("static analysis engine marks unsupported helper-hidden stylesheet propagation as unknown reachability", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/LayoutShell.tsx",
        sourceText: [
          'import "./LayoutShell.css";',
          "export function LayoutShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="layout-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/helpers.tsx",
        sourceText: [
          'import { LayoutShell } from "./LayoutShell";',
          "export function renderLayout(mode: string) {",
          '  return <LayoutShell><h1 className="page-title" /></LayoutShell>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { renderLayout } from "./helpers";',
          "export function App({ showLayout }: { showLayout: boolean }) {",
          '  return showLayout ? renderLayout() : <main className="page-title" />;',
          "}",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/LayoutShell.css",
        cssText: ".layout-shell .page-title { width: 100%; }",
      },
    ],
  });

  const appUnknownComponentContext = result.reachabilitySummary.stylesheets[0].contexts.find(
    (contextRecord) =>
      contextRecord.context.kind === "component" &&
      contextRecord.context.filePath === "src/App.tsx" &&
      contextRecord.context.componentName === "App" &&
      contextRecord.availability === "unknown",
  );
  assert.deepEqual(
    {
      context: appUnknownComponentContext.context,
      availability: appUnknownComponentContext.availability,
      reasons: appUnknownComponentContext.reasons,
      derivations: appUnknownComponentContext.derivations,
    },
    {
      context: {
        kind: "component",
        filePath: "src/App.tsx",
        componentName: "App",
      },
      availability: "unknown",
      reasons: [
        "component contains unsupported or budget-limited render expansion that may hide stylesheet availability",
      ],
      derivations: [
        {
          kind: "whole-component-unknown-barrier",
          reason: "cross-file-helper-expansion-unsupported-arguments",
        },
      ],
    },
  );
  assert.deepEqual(appUnknownComponentContext.traces, [
    {
      traceId: "reachability-context:component:unknown",
      category: "reachability",
      summary:
        "component contains unsupported or budget-limited render expansion that may hide stylesheet availability",
      children: [],
      metadata: {
        contextKind: "component",
        availability: "unknown",
        derivations: [
          "whole-component-unknown-barrier:cross-file-helper-expansion-unsupported-arguments",
        ],
      },
    },
  ]);

  const appUnknownBranchContext = result.reachabilitySummary.stylesheets[0].contexts.find(
    (contextRecord) =>
      contextRecord.context.kind === "render-region" &&
      contextRecord.context.filePath === "src/App.tsx" &&
      contextRecord.context.componentName === "App" &&
      contextRecord.context.regionKind === "conditional-branch" &&
      contextRecord.context.path.length === 2 &&
      contextRecord.context.path[1]?.kind === "conditional-branch" &&
      contextRecord.context.path[1]?.branch === "when-true",
  );
  assert.deepEqual(
    {
      context: appUnknownBranchContext.context,
      availability: appUnknownBranchContext.availability,
      reasons: appUnknownBranchContext.reasons,
      derivations: appUnknownBranchContext.derivations,
    },
    {
      context: {
        kind: "render-region",
        filePath: "src/App.tsx",
        componentName: "App",
        regionKind: "conditional-branch",
        path: [{ kind: "root" }, { kind: "conditional-branch", branch: "when-true" }],
        sourceAnchor: {
          startLine: 3,
          startColumn: 23,
          endLine: 3,
          endColumn: 37,
        },
      },
      availability: "unknown",
      reasons: [
        "render region contains unsupported or budget-limited expansion that may hide stylesheet availability",
      ],
      derivations: [
        {
          kind: "render-region-unknown-barrier",
          reason: "cross-file-helper-expansion-unsupported-arguments",
        },
      ],
    },
  );
  assert.deepEqual(appUnknownBranchContext.traces, [
    {
      traceId: "reachability-context:render-region:unknown",
      category: "reachability",
      summary:
        "render region contains unsupported or budget-limited expansion that may hide stylesheet availability",
      anchor: {
        filePath: "src/App.tsx",
        startLine: 3,
        startColumn: 23,
        endLine: 3,
        endColumn: 37,
      },
      children: [],
      metadata: {
        contextKind: "render-region",
        availability: "unknown",
        derivations: [
          "render-region-unknown-barrier:cross-file-helper-expansion-unsupported-arguments",
        ],
      },
    },
  ]);
});

test("static analysis engine can narrow css-source selector analysis to reachable render regions", () => {
  const [selectorQuery] = buildParsedSelectorQueries([
    {
      selectorText: ".shell .title",
      source: {
        kind: "css-source",
        selectorAnchor: {
          filePath: "src/shell.css",
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 14,
        },
      },
    },
  ]);

  const result = analyzeSelectorQueries({
    selectorQueries: [selectorQuery],
    renderSubtrees: [
      {
        componentName: "App",
        exported: true,
        sourceAnchor: {
          filePath: "src/App.tsx",
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 1,
        },
        root: {
          kind: "conditional",
          sourceAnchor: {
            filePath: "src/App.tsx",
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 70,
          },
          conditionSourceText: "showShell",
          whenTrue: {
            kind: "element",
            tagName: "section",
            className: {
              sourceAnchor: {
                filePath: "src/App.tsx",
                startLine: 1,
                startColumn: 20,
                endLine: 1,
                endColumn: 27,
              },
              value: {
                kind: "string-exact",
                value: "shell",
              },
              classes: {
                definite: ["shell"],
                possible: [],
                mutuallyExclusiveGroups: [],
                unknownDynamic: false,
                derivedFrom: [],
              },
              sourceText: '"shell"',
            },
            sourceAnchor: {
              filePath: "src/App.tsx",
              startLine: 1,
              startColumn: 12,
              endLine: 1,
              endColumn: 48,
            },
            children: [
              {
                kind: "element",
                tagName: "h1",
                className: {
                  sourceAnchor: {
                    filePath: "src/App.tsx",
                    startLine: 1,
                    startColumn: 37,
                    endLine: 1,
                    endColumn: 44,
                  },
                  value: {
                    kind: "string-exact",
                    value: "title",
                  },
                  classes: {
                    definite: ["title"],
                    possible: [],
                    mutuallyExclusiveGroups: [],
                    unknownDynamic: false,
                    derivedFrom: [],
                  },
                  sourceText: '"title"',
                },
                sourceAnchor: {
                  filePath: "src/App.tsx",
                  startLine: 1,
                  startColumn: 32,
                  endLine: 1,
                  endColumn: 44,
                },
                children: [],
              },
            ],
          },
          whenFalse: {
            kind: "element",
            tagName: "main",
            className: {
              sourceAnchor: {
                filePath: "src/App.tsx",
                startLine: 1,
                startColumn: 59,
                endLine: 1,
                endColumn: 66,
              },
              value: {
                kind: "string-exact",
                value: "shell",
              },
              classes: {
                definite: ["shell"],
                possible: [],
                mutuallyExclusiveGroups: [],
                unknownDynamic: false,
                derivedFrom: [],
              },
              sourceText: '"shell"',
            },
            sourceAnchor: {
              filePath: "src/App.tsx",
              startLine: 1,
              startColumn: 53,
              endLine: 1,
              endColumn: 70,
            },
            children: [],
          },
        },
      },
    ],
    reachabilitySummary: {
      stylesheets: [
        {
          cssFilePath: "src/shell.css",
          availability: "possible",
          reasons: ["test reachability summary"],
          contexts: [
            {
              context: {
                kind: "render-region",
                filePath: "src/App.tsx",
                componentName: "App",
                regionKind: "conditional-branch",
                path: [{ kind: "root" }, { kind: "conditional-branch", branch: "when-true" }],
                sourceAnchor: {
                  filePath: "src/App.tsx",
                  startLine: 1,
                  startColumn: 12,
                  endLine: 1,
                  endColumn: 48,
                },
              },
              availability: "possible",
              reasons: ["stylesheet is only reachable in the true branch"],
            },
          ],
        },
      ],
    },
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].outcome, "possible-match");
  assert.equal(result[0].status, "resolved");
  assert.equal(result[0].confidence, "medium");
});

test("selector parser emits a step/combinator IR for parent-child selectors", () => {
  const parsed = buildParsedSelectorQueries([
    {
      selectorText: ".toolbar > .toolbar__button",
      source: {
        kind: "direct-query",
      },
    },
  ]);

  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].normalizedSelector, {
    kind: "selector-chain",
    steps: [
      {
        combinatorFromPrevious: null,
        selector: {
          kind: "class-only",
          requiredClasses: ["toolbar"],
        },
      },
      {
        combinatorFromPrevious: "child",
        selector: {
          kind: "class-only",
          requiredClasses: ["toolbar__button"],
        },
      },
    ],
  });
});

test("selector parser emits a step/combinator IR for adjacent sibling selectors", () => {
  const parsed = buildParsedSelectorQueries([
    {
      selectorText: ".toolbar__label + .toolbar__button",
      source: {
        kind: "direct-query",
      },
    },
  ]);

  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].normalizedSelector, {
    kind: "selector-chain",
    steps: [
      {
        combinatorFromPrevious: null,
        selector: {
          kind: "class-only",
          requiredClasses: ["toolbar__label"],
        },
      },
      {
        combinatorFromPrevious: "adjacent-sibling",
        selector: {
          kind: "class-only",
          requiredClasses: ["toolbar__button"],
        },
      },
    ],
  });
});

test("selector parser emits same-node chain steps for compound class selectors", () => {
  const parsed = buildParsedSelectorQueries([
    {
      selectorText: ".panel.is-open",
      source: {
        kind: "direct-query",
      },
    },
  ]);

  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].normalizedSelector, {
    kind: "selector-chain",
    steps: [
      {
        combinatorFromPrevious: null,
        selector: {
          kind: "class-only",
          requiredClasses: ["panel"],
        },
      },
      {
        combinatorFromPrevious: "same-node",
        selector: {
          kind: "class-only",
          requiredClasses: ["is-open"],
        },
      },
    ],
  });
});
