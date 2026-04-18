import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSourceText } from "../../../dist/static-analysis-engine.js";
import { parseSelectorQueries } from "../../../dist/static-analysis-engine/pipeline/selector-analysis/parseSelectorQueries.js";

test("static analysis engine builds a same-file module model with imports and symbols", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      'import React from "react";',
      'import { Button } from "./Button";',
      'import "./App.css";',
      "export function App() {",
      '  return <div className="app-shell" />;',
      "}",
    ].join("\n"),
  });

  const moduleNode = result.moduleGraph.modulesById.get("module:src/App.tsx");

  assert.ok(moduleNode);
  assert.equal(moduleNode.imports.length, 3);
  assert.deepEqual(
    moduleNode.imports.map((entry) => [entry.specifier, entry.importKind]),
    [
      ["react", "source"],
      ["./Button", "source"],
      ["./App.css", "css"],
    ],
  );
  assert.ok(result.symbols.has("symbol:module:src/App.tsx:React"));
  assert.ok(result.symbols.has("symbol:module:src/App.tsx:Button"));
  assert.ok(result.symbols.has("symbol:module:src/App.tsx:App"));
});

test("static analysis engine extracts exact class strings into definite class sets", () => {
  const result = analyzeSourceText({
    filePath: "src/Button.tsx",
    sourceText:
      'export function Button() { return <button className="button button--primary" />; }',
  });

  assert.equal(result.classExpressions.length, 1);
  assert.deepEqual(result.classExpressions[0].value, {
    kind: "string-exact",
    value: "button button--primary",
  });
  assert.deepEqual(result.classExpressions[0].classes.definite, ["button", "button--primary"]);
  assert.deepEqual(result.classExpressions[0].classes.possible, []);
  assert.equal(result.classExpressions[0].classes.unknownDynamic, false);
  assert.deepEqual(result.selectorQueryResults, []);
});

test("static analysis engine preserves bounded conditional class uncertainty", () => {
  const result = analyzeSourceText({
    filePath: "src/Panel.tsx",
    sourceText: [
      "export function Panel({ isOpen }: { isOpen: boolean }) {",
      '  return <section className={isOpen ? "panel is-open" : "panel"} />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.classExpressions.length, 1);
  assert.deepEqual(result.classExpressions[0].value, {
    kind: "string-set",
    values: ["panel", "panel is-open"],
  });
  assert.deepEqual(result.classExpressions[0].classes.definite, ["panel"]);
  assert.deepEqual(result.classExpressions[0].classes.possible, ["is-open"]);
  assert.equal(result.classExpressions[0].classes.unknownDynamic, false);
});

test("static analysis engine degrades unsupported class expressions to unknown", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "const classes = getClasses();",
      "export function App() {",
      "  return <div className={classes} />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.classExpressions.length, 1);
  assert.deepEqual(result.classExpressions[0].value, {
    kind: "unknown",
    reason: "unsupported-expression:Identifier",
  });
  assert.equal(result.classExpressions[0].classes.unknownDynamic, true);
});

test("static analysis engine builds a same-file render subtree for intrinsic JSX", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  return <section className="app-shell"><h1 className="app-title" /></section>;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].componentName, "App");
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.equal(result.renderSubtrees[0].root.tagName, "section");
  assert.deepEqual(result.renderSubtrees[0].root.className?.classes.definite, ["app-shell"]);
  assert.equal(result.renderSubtrees[0].root.children.length, 1);
  assert.equal(result.renderSubtrees[0].root.children[0].kind, "element");
  assert.equal(result.renderSubtrees[0].root.children[0].tagName, "h1");
});

test("static analysis engine preserves conditional render branches in the subtree IR", () => {
  const result = analyzeSourceText({
    filePath: "src/Panel.tsx",
    sourceText: [
      "export function Panel({ isOpen }: { isOpen: boolean }) {",
      '  return isOpen ? <section className="panel is-open" /> : <section className="panel" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "conditional");
  assert.equal(result.renderSubtrees[0].root.conditionSourceText, "isOpen");
  assert.equal(result.renderSubtrees[0].root.whenTrue.kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.whenTrue.className?.classes.definite, [
    "panel",
    "is-open",
  ]);
  assert.equal(result.renderSubtrees[0].root.whenFalse.kind, "element");
});

test("static analysis engine records unresolved component references explicitly", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Child() {",
      '  return <div className="child" />;',
      "}",
      "export function App() {",
      "  return <Child />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "component-reference");
  assert.equal(result.renderSubtrees[1].root.componentName, "Child");
  assert.equal(result.renderSubtrees[1].root.reason, "local-component-expansion-not-implemented");
});

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

test("selector parser emits a step/combinator IR for parent-child selectors", () => {
  const parsed = parseSelectorQueries([
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
  const parsed = parseSelectorQueries([
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
  const parsed = parseSelectorQueries([
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
