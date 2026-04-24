import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeProjectSourceTexts,
  analyzeSourceText,
} from "../../../dist/static-analysis-engine.js";

const FONT_AWESOME_PROVIDER = {
  provider: "font-awesome",
  match: ["**/cdnjs.cloudflare.com/ajax/libs/font-awesome/**/css/*.css"],
  classPrefixes: ["fa-"],
  classNames: ["fa", "fa-solid", "fa-regular", "fa-brands"],
};

test("static analysis engine emits an experimental selector-never-satisfied result for resolved no-match selectors", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  return <section className="panel-shell"><h1 className="panel-title" /></section>;',
      "}",
    ].join("\n"),
    selectorQueries: [".panel-shell .missing-child"],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "no-match-under-bounded-analysis");
  assert.equal(result.selectorQueryResults[0].status, "resolved");
  assert.equal(result.experimentalRuleResults.length, 1);
  assert.equal(result.experimentalRuleResults[0].ruleId, "selector-never-satisfied");
  assert.equal(result.experimentalRuleResults[0].severity, "info");
  assert.equal(
    result.experimentalRuleResults[0].summary,
    "selector appears never satisfied under bounded analysis: .panel-shell .missing-child",
  );
  assert.deepEqual(
    result.experimentalRuleResults[0].selectorQueryResult,
    result.selectorQueryResults[0],
  );
  assert.equal(
    result.experimentalRuleResults[0].reasons[0],
    "experimental Phase 7 pilot rule derived from resolved selector satisfiability analysis",
  );
  assert.ok(
    result.experimentalRuleResults[0].reasons.some(
      (reason) => reason.includes('ancestor "panel-shell"') && reason.includes('"missing-child"'),
    ),
  );
});

test("static analysis engine emits an experimental selector-possibly-satisfied result for possible matches", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App({ showTitle }: { showTitle: boolean }) {",
      '  return showTitle ? <section className="panel-shell"><h1 className="panel-title" /></section> : <section className="panel-shell" />;',
      "}",
    ].join("\n"),
    selectorQueries: [".panel-shell .panel-title"],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "possible-match");
  assert.equal(result.experimentalRuleResults.length, 1);
  assert.equal(result.experimentalRuleResults[0].ruleId, "selector-possibly-satisfied");
  assert.equal(
    result.experimentalRuleResults[0].summary,
    "selector is only possibly satisfied under bounded analysis: .panel-shell .panel-title",
  );
  assert.equal(
    result.experimentalRuleResults[0].reasons[0],
    "experimental Phase 7 pilot rule derived from bounded selector uncertainty",
  );
});

test("static analysis engine preserves producer-owned traces on selector-derived rule results", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/LayoutShell.tsx",
        sourceText: [
          'import "./App.css";',
          "export function LayoutShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="panel-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { LayoutShell } from "./LayoutShell";',
          "export function App({ showTitle }: { showTitle: boolean }) {",
          '  return showTitle ? <LayoutShell><h1 className="panel-title" /></LayoutShell> : <main className="panel-title" />;',
          "}",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".panel-shell .panel-title { color: red; }",
      },
    ],
  });

  assert.equal(result.experimentalRuleResults.length, 1);
  assert.equal(result.experimentalRuleResults[0].ruleId, "selector-possibly-satisfied");
  assert.deepEqual(result.experimentalRuleResults[0].traces, [
    {
      traceId: "rule-evaluation:selector-possibly-satisfied:.panel-shell .panel-title",
      category: "rule-evaluation",
      summary:
        "selector is only possibly satisfied under bounded analysis: .panel-shell .panel-title",
      anchor: {
        filePath: "src/App.css",
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 26,
      },
      children: result.selectorQueryResults[0].decision.traces,
      metadata: {
        ruleId: "selector-possibly-satisfied",
        selectorText: ".panel-shell .panel-title",
        outcome: "possible-match",
        status: "resolved",
      },
    },
  ]);
});

test("static analysis engine emits an experimental selector-analysis-unsupported result for unsupported selectors", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="app-shell" />; }',
    selectorQueries: [".app-shell[role]"],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].status, "unsupported");
  assert.equal(result.experimentalRuleResults.length, 1);
  assert.equal(result.experimentalRuleResults[0].ruleId, "selector-analysis-unsupported");
  assert.equal(
    result.experimentalRuleResults[0].summary,
    "selector could not be evaluated under bounded analysis: .app-shell[role]",
  );
  assert.equal(
    result.experimentalRuleResults[0].reasons[0],
    "experimental Phase 7 pilot rule derived from unsupported bounded selector analysis",
  );
});

test("static analysis engine preserves producer-owned lineage for unsupported selector rule results", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="app-shell" />; }',
    selectorQueries: [".app-shell[role]"],
  });

  assert.equal(result.experimentalRuleResults.length, 1);
  assert.equal(result.experimentalRuleResults[0].ruleId, "selector-analysis-unsupported");
  assert.deepEqual(result.experimentalRuleResults[0].traces, [
    {
      traceId: "rule-evaluation:selector-analysis-unsupported:.app-shell[role]",
      category: "rule-evaluation",
      summary: "selector could not be evaluated under bounded analysis: .app-shell[role]",
      children: result.selectorQueryResults[0].decision.traces,
      metadata: {
        ruleId: "selector-analysis-unsupported",
        selectorText: ".app-shell[role]",
        outcome: "possible-match",
        status: "unsupported",
      },
    },
  ]);
});

test("static analysis engine emits an unused-compound-selector-branch result for impossible css-derived compound branches", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="panel" />; }',
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".panel.is-open { color: red; }",
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "no-match-under-bounded-analysis");
  assert.equal(result.experimentalRuleResults.length, 2);
  assert.ok(
    result.experimentalRuleResults.some(
      (ruleResult) => ruleResult.ruleId === "unused-compound-selector-branch",
    ),
  );
  assert.ok(
    result.experimentalRuleResults.some(
      (ruleResult) => ruleResult.ruleId === "selector-never-satisfied",
    ),
  );
});

test("static analysis engine emits a contextual-selector-branch-never-satisfied result for impossible css-derived structural selectors", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText:
      'export function App() { return <section className="panel-shell"><h1 className="panel-title" /></section>; }',
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".panel-shell .missing-child { color: red; }",
      },
    ],
  });

  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "no-match-under-bounded-analysis");
  assert.equal(result.experimentalRuleResults.length, 2);
  assert.ok(
    result.experimentalRuleResults.some(
      (ruleResult) => ruleResult.ruleId === "contextual-selector-branch-never-satisfied",
    ),
  );
  assert.ok(
    result.experimentalRuleResults.some(
      (ruleResult) => ruleResult.ruleId === "selector-never-satisfied",
    ),
  );
});

test("static analysis engine emits an empty-css-rule result for selector blocks without declarations", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="empty" />; }',
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".empty {}",
      },
    ],
  });

  const emptyRuleResult = result.experimentalRuleResults.find(
    (ruleResult) => ruleResult.ruleId === "empty-css-rule",
  );
  assert.ok(emptyRuleResult);
  assert.equal(emptyRuleResult.severity, "warning");
  assert.equal(emptyRuleResult.confidence, "high");
  assert.equal(
    emptyRuleResult.summary,
    'Selector ".empty" in "src/App.css" does not contain any CSS declarations.',
  );
  assert.deepEqual(emptyRuleResult.primaryLocation, {
    filePath: "src/App.css",
    line: 1,
  });
});

test("static analysis engine preserves uniform rule-level traces for non-selector CSS rules", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="empty" />; }',
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".empty {}",
      },
    ],
  });

  const emptyRuleResult = result.experimentalRuleResults.find(
    (ruleResult) => ruleResult.ruleId === "empty-css-rule",
  );
  assert.ok(emptyRuleResult);
  assert.deepEqual(emptyRuleResult.traces, [
    {
      traceId: "rule-evaluation:empty-css-rule:src/App.css:1",
      category: "rule-evaluation",
      summary: 'Selector ".empty" in "src/App.css" does not contain any CSS declarations.',
      anchor: {
        filePath: "src/App.css",
        startLine: 1,
        startColumn: 1,
        endLine: 1,
      },
      children: [],
      metadata: {
        selector: ".empty",
      },
    },
  ]);
});

test("static analysis engine emits a redundant-css-declaration-block result for repeated declaration blocks", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="button" />; }',
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: [".button { color: red; }", ".button { color: red; }"].join("\n"),
      },
    ],
  });

  const redundantRuleResult = result.experimentalRuleResults.find(
    (ruleResult) => ruleResult.ruleId === "redundant-css-declaration-block",
  );
  assert.ok(redundantRuleResult);
  assert.equal(redundantRuleResult.severity, "info");
  assert.equal(redundantRuleResult.confidence, "high");
  assert.equal(
    redundantRuleResult.summary,
    'Class "button" repeats the same CSS declarations in the same selector and at-rule context.',
  );
  assert.deepEqual(redundantRuleResult.primaryLocation, {
    filePath: "src/App.css",
    line: 1,
  });
});

test("static analysis engine emits a duplicate-css-class-definition result for repeated root class definitions", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="button" />; }',
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".button { color: red; }",
      },
      {
        filePath: "src/Other.css",
        cssText: ".button { color: blue; }",
      },
    ],
  });

  const duplicateRuleResult = result.experimentalRuleResults.find(
    (ruleResult) => ruleResult.ruleId === "duplicate-css-class-definition",
  );
  assert.ok(duplicateRuleResult);
  assert.equal(duplicateRuleResult.severity, "warning");
  assert.equal(duplicateRuleResult.confidence, "high");
  assert.equal(
    duplicateRuleResult.summary,
    'Class "button" is defined in multiple locations in project CSS, which may be confusing or redundant.',
  );
  assert.deepEqual(duplicateRuleResult.primaryLocation, {
    filePath: "src/App.css",
    line: 1,
  });
});

test("static analysis engine does not group duplicate root class definitions across different media contexts", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: 'export function App() { return <div className="button" />; }',
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: "@media (min-width: 768px) { .button { color: red; } }",
      },
      {
        filePath: "src/Other.css",
        cssText: "@media (min-width: 1024px) { .button { color: blue; } }",
      },
    ],
  });

  const duplicateRuleResult = result.experimentalRuleResults.find(
    (ruleResult) => ruleResult.ruleId === "duplicate-css-class-definition",
  );
  assert.equal(duplicateRuleResult, undefined);
});

test("static analysis engine emits missing-external-css-class for unresolved classes when imported external css is in play", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import "bootstrap/dist/css/bootstrap.css";',
          'export function App() { return <div className="btn ghost-btn" />; }',
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "bootstrap/dist/css/bootstrap.css",
        cssText: ".btn { display: inline-block; }",
      },
    ],
  });

  const missingExternalCssResults = result.experimentalRuleResults.filter(
    (ruleResult) => ruleResult.ruleId === "missing-external-css-class",
  );
  assert.equal(missingExternalCssResults.length, 1);
  assert.equal(
    missingExternalCssResults[0].summary,
    'Class "ghost-btn" appears intended to come from imported external CSS, but no matching imported external stylesheet definition was found.',
  );
  assert.equal(missingExternalCssResults[0].primaryLocation?.filePath, "src/App.tsx");
  assert.equal(missingExternalCssResults[0].primaryLocation?.line, 2);
  assert.deepEqual(missingExternalCssResults[0].metadata?.externalStylesheetPaths, [
    "bootstrap/dist/css/bootstrap.css",
  ]);
});

test("static analysis engine suppresses missing-external-css-class when a declared provider satisfies the token", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import "bootstrap/dist/css/bootstrap.css";',
          'export function App() { return <div className="btn fa-solid fa-trash ghost-btn" />; }',
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "bootstrap/dist/css/bootstrap.css",
        cssText: ".btn { display: inline-block; }",
      },
    ],
    externalCss: {
      enabled: true,
      mode: "declared-globals",
      globalProviders: [FONT_AWESOME_PROVIDER],
      htmlStylesheetLinks: [
        {
          filePath: "index.html",
          href: "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
          isRemote: true,
        },
      ],
    },
  });

  const missingExternalCssResults = result.experimentalRuleResults.filter(
    (ruleResult) => ruleResult.ruleId === "missing-external-css-class",
  );
  assert.deepEqual(
    missingExternalCssResults.map((ruleResult) => ruleResult.metadata?.className),
    ["ghost-btn"],
  );
});

test("static analysis engine emits missing-external-css-class for unresolved classes when fetch-remote external css is project-wide", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText:
          'export function App() { return <button className="btn ghost-btn">Save</button>; }',
      },
    ],
    selectorCssSources: [
      {
        filePath: "https://cdn.example.com/ui/buttons.css",
        cssText: ".btn { color: red; }",
      },
    ],
    externalCss: {
      enabled: true,
      mode: "fetch-remote",
      globalProviders: [],
      htmlStylesheetLinks: [
        {
          filePath: "index.html",
          href: "https://cdn.example.com/ui/buttons.css",
          isRemote: true,
        },
      ],
    },
  });

  const missingExternalCssResults = result.experimentalRuleResults.filter(
    (ruleResult) => ruleResult.ruleId === "missing-external-css-class",
  );
  assert.equal(missingExternalCssResults.length, 1);
  assert.equal(missingExternalCssResults[0].metadata?.className, "ghost-btn");
  assert.deepEqual(missingExternalCssResults[0].metadata?.externalStylesheetPaths, [
    "https://cdn.example.com/ui/buttons.css",
  ]);
});

test("static analysis engine does not emit missing-external-css-class when only local project css is in play", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import "./App.css";',
          'export function App() { return <div className="ghost-btn" />; }',
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".btn { color: red; }",
      },
    ],
  });

  assert.equal(
    result.experimentalRuleResults.some(
      (ruleResult) => ruleResult.ruleId === "missing-external-css-class",
    ),
    false,
  );
});
