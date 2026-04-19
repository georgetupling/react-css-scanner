import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeProjectSourceTexts,
  analyzeSourceText,
} from "../../../dist/static-analysis-engine.js";

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
  assert.deepEqual(
    moduleNode.exports.map((entry) => [entry.exportedName, entry.sourceExportedName ?? null]),
    [["App", "App"]],
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

test("static analysis engine builds a multi-file module graph with resolved relative imports", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { PanelShell } from "./PanelShell";',
          "export function App() {",
          "  return <PanelShell />;",
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/PanelShell.tsx",
        sourceText: [
          "export function PanelShell() {",
          '  return <section className="panel-shell" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  assert.equal(result.moduleGraph.modulesById.size, 2);
  const appModule = result.moduleGraph.modulesById.get("module:src/App.tsx");
  const importedPanelShellSymbol = result.symbols.get("symbol:module:src/App.tsx:PanelShell");
  assert.ok(appModule);
  assert.equal(appModule.imports.length, 1);
  assert.equal(appModule.imports[0].resolvedModuleId, "module:src/PanelShell.tsx");
  assert.deepEqual(
    result.moduleGraph.modulesById
      .get("module:src/PanelShell.tsx")
      ?.exports.map((entry) => [entry.exportedName, entry.sourceExportedName ?? null]),
    [["PanelShell", "PanelShell"]],
  );
  assert.deepEqual(importedPanelShellSymbol?.resolution, {
    kind: "imported",
    targetModuleId: "module:src/PanelShell.tsx",
    targetSymbolId: "symbol:module:src/PanelShell.tsx:PanelShell",
    traces: [
      {
        traceId: "symbol-resolution:direct-export:src/PanelShell.tsx:PanelShell",
        category: "symbol-resolution",
        summary: "resolved export PanelShell directly from src/PanelShell.tsx",
        anchor: {
          filePath: "src/App.tsx",
          startLine: 1,
          startColumn: 10,
          endLine: 1,
          endColumn: 20,
        },
        children: [],
        metadata: {
          filePath: "src/PanelShell.tsx",
          exportedName: "PanelShell",
          resolution: "direct-export",
        },
      },
    ],
  });
  assert.ok(result.symbols.has("symbol:module:src/App.tsx:PanelShell"));
  assert.ok(result.symbols.has("symbol:module:src/PanelShell.tsx:PanelShell"));
});

test("static analysis engine preserves producer-owned symbol-resolution traces for unresolved imports", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { MissingPanel } from "./PanelShell";',
          "export function App() {",
          "  return <MissingPanel />;",
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/PanelShell.tsx",
        sourceText: [
          "export function PanelShell() {",
          '  return <section className="panel-shell" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  assert.deepEqual(result.symbols.get("symbol:module:src/App.tsx:MissingPanel")?.resolution, {
    kind: "unresolved",
    reason: "export-not-found",
    traces: [
      {
        traceId: "symbol-resolution:export-not-found:src/PanelShell.tsx:MissingPanel",
        category: "symbol-resolution",
        summary: "could not resolve export MissingPanel from src/PanelShell.tsx",
        anchor: {
          filePath: "src/App.tsx",
          startLine: 1,
          startColumn: 10,
          endLine: 1,
          endColumn: 22,
        },
        children: [],
        metadata: {
          filePath: "src/PanelShell.tsx",
          exportedName: "MissingPanel",
          reason: "export-not-found",
        },
      },
    ],
  });
});
