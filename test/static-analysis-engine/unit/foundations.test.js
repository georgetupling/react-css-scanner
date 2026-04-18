import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSourceText } from "../../../dist/static-analysis-engine.js";

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
