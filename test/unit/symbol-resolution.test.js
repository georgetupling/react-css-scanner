import assert from "node:assert/strict";
import test from "node:test";

import ts from "typescript";

import {
  buildModuleFacts,
  buildProjectBindingResolution,
  collectSourceSymbols,
  createSymbolId,
  getExportedExpressionBindingsForFile,
  getCssModuleBindingsForFile,
  getImportedComponentBindingsForFile,
  getImportedExpressionBindingsBySymbolIdForFile,
  getLocalAliasAt,
  getLocalAliasResolutionsForFile,
  getNamespaceImportsForFile,
  getScopeAt,
  getSymbol,
  getSymbolAt,
  getSymbolReferenceAt,
  resolveLocalAliasAt,
  resolveCssModuleMember,
  resolveCssModuleMemberAccess,
  resolveCssModuleNamespace,
  resolveReferenceAt,
  resolveExportedTypeDeclaration,
  resolveExportedTypeBinding,
  resolveTypeDeclaration,
  resolveTypeBinding,
} from "../../dist/static-analysis-engine.js";

test("symbol resolution owns exported expression bindings and imported expression propagation", () => {
  const parsedFiles = [
    sourceFile(
      "src/tokens.ts",
      `
        const privateToken = "private-token";
        export const publicToken = "public-token";
        export const buttonTokens = ["btn", "btn--primary"] as const;
      `,
    ),
    sourceFile(
      "src/defaultIdentifier.ts",
      `
        const defaultToken = "default-token";
        export default defaultToken;
      `,
    ),
    sourceFile("src/defaultExpression.ts", 'export default "literal-default";'),
    sourceFile("src/consumer.ts", 'import { publicToken } from "./tokens.ts";'),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  assert.deepEqual(
    [
      ...getExportedExpressionBindingsForFile({
        symbolResolution: resolution,
        filePath: "src/tokens.ts",
      }).keys(),
    ],
    ["publicToken", "buttonTokens"],
  );
  assert.equal(
    expressionText(
      getExportedExpressionBindingsForFile({
        symbolResolution: resolution,
        filePath: "src/defaultIdentifier.ts",
      }).get("default"),
    ),
    '"default-token"',
  );
  assert.equal(
    expressionText(
      getExportedExpressionBindingsForFile({
        symbolResolution: resolution,
        filePath: "src/defaultExpression.ts",
      }).get("default"),
    ),
    '"literal-default"',
  );
  const importedBindingSymbolId = getSymbol({
    symbolResolution: resolution,
    filePath: "src/consumer.ts",
    localName: "publicToken",
    symbolSpace: "value",
  })?.id;
  assert.equal(
    expressionText(
      getImportedExpressionBindingsBySymbolIdForFile({
        symbolResolution: resolution,
        filePath: "src/consumer.ts",
      }).get(importedBindingSymbolId ?? ""),
    ),
    '"public-token"',
  );
  assert.equal(
    expressionText(
      importedBindingSymbolId
        ? getImportedExpressionBindingsBySymbolIdForFile({
            symbolResolution: resolution,
            filePath: "src/consumer.ts",
          }).get(importedBindingSymbolId)
        : undefined,
    ),
    '"public-token"',
  );
});

test("symbol resolution derives exported names from module facts and collects richer symbol kinds", () => {
  const parsedFiles = [
    sourceFile(
      "src/library.tsx",
      `
        class PlainModel {}
        export class Widget extends React.Component {}
        class InternalButton {}
        export { InternalButton as Button, InternalButton as PrimaryButton };
        export interface ButtonProps { variant: "primary" | "secondary"; }
        export type ButtonTone = ButtonProps["variant"];
        export enum Size { Small = "small" }
        export namespace Theme { export const root = "root"; }
      `,
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });

  const symbols = collectSourceSymbols({
    filePath: "src/library.tsx",
    parsedSourceFile: parsedFiles[0].parsedSourceFile,
    moduleId: "module:src/library.tsx",
    moduleFacts,
  }).symbols;
  const symbolsByLocalName = new Map(
    [...symbols.values()].map((symbol) => [symbol.localName, symbol]),
  );

  assert.equal(symbolsByLocalName.get("PlainModel")?.kind, "class");
  assert.equal(symbolsByLocalName.get("Widget")?.kind, "component");
  assert.deepEqual(symbolsByLocalName.get("InternalButton")?.exportedNames, [
    "Button",
    "PrimaryButton",
  ]);
  assert.equal(symbolsByLocalName.get("ButtonProps")?.kind, "interface");
  assert.deepEqual(symbolsByLocalName.get("ButtonProps")?.exportedNames, ["ButtonProps"]);
  assert.equal(symbolsByLocalName.get("ButtonTone")?.kind, "type-alias");
  assert.equal(symbolsByLocalName.get("Size")?.kind, "enum");
  assert.equal(symbolsByLocalName.get("Theme")?.kind, "namespace");

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });
  assert.equal(
    getSymbol({
      symbolResolution: resolution,
      filePath: "src/library.tsx",
      localName: "Widget",
      symbolSpace: "value",
    })?.kind,
    "component",
  );
  assert.equal(
    getSymbol({
      symbolResolution: resolution,
      filePath: "src/library.tsx",
      localName: "ButtonTone",
      symbolSpace: "value",
    }),
    undefined,
  );
});

test("symbol resolution uses syntax-backed component detection for imported component bindings", () => {
  const parsedFiles = [
    sourceFile(
      "src/components.tsx",
      `
        export const API_URL = "https://example.test";
        function BaseButton() { return <button />; }
        export const Button = memo(BaseButton);
        export const Link = React.forwardRef(function LinkImpl() { return <a />; });
        export const helper = format(Button);
      `,
    ),
    sourceFile(
      "src/consumer.tsx",
      `
        import { API_URL, Button, Link, helper } from "./components.tsx";
      `,
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  const sourceSymbols = collectSourceSymbols({
    filePath: "src/components.tsx",
    parsedSourceFile: parsedFiles[0].parsedSourceFile,
    moduleId: "module:src/components.tsx",
    moduleFacts,
  }).symbols;
  const symbolsByLocalName = new Map(
    [...sourceSymbols.values()].map((symbol) => [symbol.localName, symbol]),
  );

  assert.equal(symbolsByLocalName.get("API_URL")?.kind, "constant");
  assert.equal(symbolsByLocalName.get("Button")?.kind, "component");
  assert.equal(symbolsByLocalName.get("Link")?.kind, "component");
  assert.equal(symbolsByLocalName.get("helper")?.kind, "constant");
  assert.deepEqual(
    getImportedComponentBindingsForFile({
      symbolResolution: resolution,
      filePath: "src/consumer.tsx",
    }).map((binding) => binding.localName),
    ["Button", "Link"],
  );
});

test("symbol resolution preserves unresolved namespace members as structured results", () => {
  const parsedFiles = [
    sourceFile(
      "src/source.ts",
      `
        export const ok = "ok";
      `,
    ),
    sourceFile(
      "src/barrel.ts",
      `
        export { ok, missing as broken } from "./source.ts";
      `,
    ),
    sourceFile(
      "src/consumer.ts",
      `
        import * as api from "./barrel.ts";
      `,
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  const namespaceImport = getNamespaceImportsForFile({
    symbolResolution: resolution,
    filePath: "src/consumer.ts",
  })[0];
  const okSymbolId = getSymbol({
    symbolResolution: resolution,
    filePath: "src/source.ts",
    localName: "ok",
    symbolSpace: "value",
  })?.id;
  assert.equal(namespaceImport?.localName, "api");
  assert.deepEqual([...(namespaceImport?.members.keys() ?? [])], ["broken", "ok"]);
  assert.deepEqual(namespaceImport?.members.get("ok"), {
    kind: "resolved",
    target: {
      targetModuleId: "module:src/source.ts",
      targetFilePath: "src/source.ts",
      targetExportName: "ok",
      targetSymbolId: okSymbolId,
    },
  });
  assert.deepEqual(namespaceImport?.members.get("broken"), {
    kind: "unresolved",
    reason: "export-not-found",
    traces: [],
  });
});

test("symbol resolution resolves imported type bindings through type re-export barrels", () => {
  const parsedFiles = [
    sourceFile(
      "src/types.ts",
      `
        export type ButtonVariant = "primary" | "ghost";
        export interface ButtonProps { variant?: ButtonVariant; }
      `,
    ),
    sourceFile(
      "src/barrel.ts",
      `
        export type { ButtonProps } from "./types.ts";
        export { type ButtonVariant as ExportedVariant } from "./types.ts";
      `,
    ),
    sourceFile(
      "src/consumer.ts",
      `
        import type { ButtonProps, ExportedVariant as Tone } from "./barrel.ts";
      `,
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });
  const buttonPropsSymbolId = getSymbol({
    symbolResolution: resolution,
    filePath: "src/types.ts",
    localName: "ButtonProps",
    symbolSpace: "type",
  })?.id;
  const buttonVariantSymbolId = getSymbol({
    symbolResolution: resolution,
    filePath: "src/types.ts",
    localName: "ButtonVariant",
    symbolSpace: "type",
  })?.id;

  assert.deepEqual(resolveTypeBindingForTest(resolution, "src/consumer.ts", "ButtonProps"), {
    localName: "ButtonProps",
    targetModuleId: "module:src/types.ts",
    targetFilePath: "src/types.ts",
    targetTypeName: "ButtonProps",
    targetSymbolId: buttonPropsSymbolId,
    traces: [],
  });
  assert.deepEqual(resolveTypeBindingForTest(resolution, "src/consumer.ts", "Tone"), {
    localName: "Tone",
    targetModuleId: "module:src/types.ts",
    targetFilePath: "src/types.ts",
    targetTypeName: "ButtonVariant",
    targetSymbolId: buttonVariantSymbolId,
    traces: [],
  });
  assert.deepEqual(
    resolveExportedTypeBindingForTest(resolution, "src/barrel.ts", "ExportedVariant"),
    {
      localName: "ExportedVariant",
      targetModuleId: "module:src/types.ts",
      targetFilePath: "src/types.ts",
      targetTypeName: "ButtonVariant",
      targetSymbolId: buttonVariantSymbolId,
      traces: [],
    },
  );
  assert.deepEqual(
    resolveTypeDeclarationForTest(parsedFiles, resolution, "src/consumer.ts", "ButtonProps"),
    {
      kind: "interface",
      declarationText: "export interface ButtonProps { variant?: ButtonVariant; }",
      binding: {
        localName: "ButtonProps",
        targetModuleId: "module:src/types.ts",
        targetFilePath: "src/types.ts",
        targetTypeName: "ButtonProps",
        targetSymbolId: buttonPropsSymbolId,
        traces: [],
      },
    },
  );
  assert.deepEqual(
    resolveExportedTypeDeclarationForTest(
      parsedFiles,
      resolution,
      "src/barrel.ts",
      "ExportedVariant",
    ),
    {
      kind: "type-alias",
      declarationText: 'export type ButtonVariant = "primary" | "ghost";',
      binding: {
        localName: "ExportedVariant",
        targetModuleId: "module:src/types.ts",
        targetFilePath: "src/types.ts",
        targetTypeName: "ButtonVariant",
        targetSymbolId: buttonVariantSymbolId,
        traces: [],
      },
    },
  );
});

test("symbol resolution resolves local type declarations through helper APIs", () => {
  const parsedFiles = [
    sourceFile(
      "src/local.ts",
      `
        export interface LocalProps { tone?: "primary" | "secondary"; }
        export type LocalTone = LocalProps["tone"];
      `,
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });
  const localToneSymbolId = getSymbol({
    symbolResolution: resolution,
    filePath: "src/local.ts",
    localName: "LocalTone",
    symbolSpace: "type",
  })?.id;
  const localPropsSymbolId = getSymbol({
    symbolResolution: resolution,
    filePath: "src/local.ts",
    localName: "LocalProps",
    symbolSpace: "type",
  })?.id;

  assert.deepEqual(resolveTypeBindingForTest(resolution, "src/local.ts", "LocalTone"), {
    localName: "LocalTone",
    targetModuleId: "module:src/local.ts",
    targetFilePath: "src/local.ts",
    targetTypeName: "LocalTone",
    targetSymbolId: localToneSymbolId,
    traces: [],
  });
  assert.deepEqual(
    resolveTypeDeclarationForTest(parsedFiles, resolution, "src/local.ts", "LocalProps"),
    {
      kind: "interface",
      declarationText: 'export interface LocalProps { tone?: "primary" | "secondary"; }',
      binding: {
        localName: "LocalProps",
        targetModuleId: "module:src/local.ts",
        targetFilePath: "src/local.ts",
        targetTypeName: "LocalProps",
        targetSymbolId: localPropsSymbolId,
        traces: [],
      },
    },
  );
  const localTypeSymbol = getSymbol({
    symbolResolution: resolution,
    filePath: "src/local.ts",
    localName: "LocalProps",
    symbolSpace: "type",
  });
  assert.equal(
    localTypeSymbol?.id,
    createSymbolId("module:src/local.ts", "LocalProps", {
      declaration: localTypeSymbol?.declaration,
      symbolSpace: "type",
    }),
  );
  assert.equal(localTypeSymbol?.kind, "interface");
  assert.deepEqual(localTypeSymbol?.exportedNames, ["LocalProps"]);
  assert.equal(localTypeSymbol?.resolution.kind, "local");
  assert.equal(
    getSymbol({
      symbolResolution: resolution,
      filePath: "src/local.ts",
      localName: "LocalProps",
      symbolSpace: "value",
    }),
    undefined,
  );
});

test("symbol resolution degrades type-only imports that target value exports", () => {
  const parsedFiles = [
    sourceFile(
      "src/source.ts",
      `
        export const buttonTone = "primary";
      `,
    ),
    sourceFile(
      "src/consumer.ts",
      `
        import type { buttonTone } from "./source.ts";
      `,
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  assert.equal(resolveTypeBindingForTest(resolution, "src/consumer.ts", "buttonTone"), undefined);
  assert.equal(
    resolveTypeDeclarationForTest(parsedFiles, resolution, "src/consumer.ts", "buttonTone"),
    undefined,
  );
  assert.equal(resolveTypeBindingForTest(resolution, "src/consumer.ts", "buttonTone"), undefined);
});

test("symbol resolution resolves CSS Module namespace, alias, destructuring, and member access", () => {
  const parsedFiles = [
    sourceFile(
      "src/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "const s = styles;",
        "const { root, button: buttonClass } = s;",
        'export function Button() { return <button className={s.root + styles["tone"] + buttonClass + root}>Button</button>; }',
        "",
      ].join("\n"),
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
    stylesheetFilePaths: ["src/Button.module.css"],
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });
  const cssModuleBindings = getCssModuleBindingsForFile({
    symbolResolution: resolution,
    filePath: "src/Button.tsx",
  });

  assert.deepEqual(
    cssModuleBindings.imports.map((binding) => binding.localName),
    ["styles"],
  );
  assert.deepEqual(
    cssModuleBindings.namespaceBindings.map((binding) => binding.localName),
    ["styles", "s"],
  );
  assert.deepEqual(
    cssModuleBindings.memberBindings.map((binding) => binding.localName),
    ["root", "buttonClass"],
  );
  assert.deepEqual(
    cssModuleBindings.memberReferences.map((binding) => binding.memberName),
    ["button", "root", "root", "tone"],
  );
  assert.deepEqual(cssModuleBindings.diagnostics, []);

  assert.deepEqual(resolveCssModuleNamespaceForTest(resolution, "src/Button.tsx", "styles"), {
    sourceFilePath: "src/Button.tsx",
    stylesheetFilePath: "src/Button.module.css",
    specifier: "./Button.module.css",
    localName: "styles",
    originLocalName: "styles",
    importKind: "default",
    sourceKind: "import",
    location: {
      filePath: "src/Button.tsx",
      startLine: 1,
      startColumn: 8,
      endLine: 1,
      endColumn: 14,
    },
    rawExpressionText: "styles",
    traces: [],
  });
  assert.deepEqual(resolveCssModuleNamespaceForTest(resolution, "src/Button.tsx", "s"), {
    sourceFilePath: "src/Button.tsx",
    stylesheetFilePath: "src/Button.module.css",
    specifier: "./Button.module.css",
    localName: "s",
    originLocalName: "styles",
    importKind: "default",
    sourceKind: "alias",
    location: {
      filePath: "src/Button.tsx",
      startLine: 2,
      startColumn: 7,
      endLine: 2,
      endColumn: 17,
    },
    rawExpressionText: "s = styles",
    traces: [],
  });
  assert.deepEqual(resolveCssModuleMemberForTest(resolution, "src/Button.tsx", "buttonClass"), {
    sourceFilePath: "src/Button.tsx",
    stylesheetFilePath: "src/Button.module.css",
    specifier: "./Button.module.css",
    localName: "buttonClass",
    originLocalName: "styles",
    memberName: "button",
    sourceKind: "destructured-binding",
    location: {
      filePath: "src/Button.tsx",
      startLine: 3,
      startColumn: 15,
      endLine: 3,
      endColumn: 34,
    },
    rawExpressionText: "button: buttonClass",
    traces: [],
  });
  assert.deepEqual(resolveCssModuleMemberAccessForTest(resolution, "src/Button.tsx", "s", "root"), {
    kind: "resolved",
    reference: {
      sourceFilePath: "src/Button.tsx",
      stylesheetFilePath: "src/Button.module.css",
      specifier: "./Button.module.css",
      localName: "s",
      originLocalName: "styles",
      memberName: "root",
      accessKind: "property",
      location: {
        filePath: "src/Button.tsx",
        startLine: 4,
        startColumn: 54,
        endLine: 4,
        endColumn: 60,
      },
      rawExpressionText: "s.root",
      traces: [],
    },
  });
  assert.deepEqual(
    resolveCssModuleMemberAccessForTest(resolution, "src/Button.tsx", "styles", "tone"),
    {
      kind: "resolved",
      reference: {
        sourceFilePath: "src/Button.tsx",
        stylesheetFilePath: "src/Button.module.css",
        specifier: "./Button.module.css",
        localName: "styles",
        originLocalName: "styles",
        memberName: "tone",
        accessKind: "string-literal-element",
        location: {
          filePath: "src/Button.tsx",
          startLine: 4,
          startColumn: 63,
          endLine: 4,
          endColumn: 77,
        },
        rawExpressionText: 'styles["tone"]',
        traces: [],
      },
    },
  );
});

test("symbol resolution records unsupported CSS Module binding diagnostics", () => {
  const parsedFiles = [
    sourceFile(
      "src/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "const name = 'root';",
        "let s = styles;",
        "const styles = styles;",
        "const { [name]: computed, ...rest, nested: { inner } } = styles;",
        "export function Button() { return <button className={styles[name]}>Button</button>; }",
        "",
      ].join("\n"),
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
    stylesheetFilePaths: ["src/Button.module.css"],
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  assert.deepEqual(
    getCssModuleBindingsForFile({
      symbolResolution: resolution,
      filePath: "src/Button.tsx",
    }).diagnostics.map((diagnostic) => diagnostic.reason),
    [
      "computed-css-module-destructuring",
      "computed-css-module-member",
      "nested-css-module-destructuring",
      "reassignable-css-module-alias",
      "rest-css-module-destructuring",
      "self-referential-css-module-alias",
    ],
  );
});

test("symbol resolution collects nested declaration identities and scope tree records", () => {
  const parsedFiles = [
    sourceFile("src/Button.tsx", "export function Button() { return <button />; }"),
    sourceFile(
      "src/Page.tsx",
      [
        'import { Button } from "./Button.tsx";',
        "export function Page({ className: initialClassName }) {",
        "  const { root: rootClass, tone } = theme;",
        "  function renderRow(item, index) {",
        "    const Row = Button;",
        "    return <Row className={initialClassName + rootClass + tone + index} />;",
        "  }",
        "  return items.map((item, index) => {",
        "    const CallbackRow = Button;",
        "    return <CallbackRow key={index} className={item.className} />;",
        "  });",
        "}",
      ].join("\n"),
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  const pageSymbol = getSymbol({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    localName: "Page",
    symbolSpace: "value",
  });
  const initialClassNameSymbol = findCollectedSymbol(resolution, {
    filePath: "src/Page.tsx",
    localName: "initialClassName",
    startLine: 2,
  });
  const rootClassSymbol = findCollectedSymbol(resolution, {
    filePath: "src/Page.tsx",
    localName: "rootClass",
    startLine: 3,
  });
  const toneSymbol = findCollectedSymbol(resolution, {
    filePath: "src/Page.tsx",
    localName: "tone",
    startLine: 3,
  });
  const renderRowSymbol = findCollectedSymbol(resolution, {
    filePath: "src/Page.tsx",
    localName: "renderRow",
    startLine: 4,
  });
  const rowSymbol = findCollectedSymbol(resolution, {
    filePath: "src/Page.tsx",
    localName: "Row",
    startLine: 5,
  });
  const callbackItemSymbol = findCollectedSymbol(resolution, {
    filePath: "src/Page.tsx",
    localName: "item",
    startLine: 8,
  });
  const callbackIndexSymbol = findCollectedSymbol(resolution, {
    filePath: "src/Page.tsx",
    localName: "index",
    startLine: 8,
  });
  const callbackRowSymbol = findCollectedSymbol(resolution, {
    filePath: "src/Page.tsx",
    localName: "CallbackRow",
    startLine: 9,
  });

  assert.notEqual(pageSymbol?.scopeId, initialClassNameSymbol?.scopeId);
  assert.equal(resolution.scopes.get(pageSymbol?.scopeId ?? "")?.kind, "module");
  assert.equal(initialClassNameSymbol?.kind, "prop");
  assert.equal(resolution.scopes.get(initialClassNameSymbol?.scopeId ?? "")?.kind, "parameter");
  assert.equal(rootClassSymbol?.kind, "constant");
  assert.equal(toneSymbol?.kind, "constant");
  assert.equal(resolution.scopes.get(rootClassSymbol?.scopeId ?? "")?.kind, "block");
  assert.equal(renderRowSymbol?.kind, "function");
  assert.equal(resolution.scopes.get(renderRowSymbol?.scopeId ?? "")?.kind, "block");
  assert.equal(rowSymbol?.kind, "component");
  assert.equal(callbackItemSymbol?.kind, "prop");
  assert.equal(callbackIndexSymbol?.kind, "prop");
  assert.equal(callbackRowSymbol?.kind, "component");
  assert.equal(
    callbackRowSymbol?.id,
    createSymbolId("module:src/Page.tsx", "CallbackRow", {
      declaration: callbackRowSymbol?.declaration,
      symbolSpace: "value",
    }),
  );

  const pageFunctionScope = findChildScopeByKind(resolution, pageSymbol?.scopeId, "function");
  const pageParameterScope = findChildScopeByKind(resolution, pageFunctionScope?.id, "parameter");
  const pageBodyScope = findChildScopeByKind(resolution, pageParameterScope?.id, "block");
  const callbackParameterScope = resolution.scopes.get(callbackItemSymbol?.scopeId ?? "");
  const callbackBodyScope = findChildScopeByKind(resolution, callbackParameterScope?.id, "block");

  assert.equal(initialClassNameSymbol?.scopeId, pageParameterScope?.id);
  assert.equal(rootClassSymbol?.scopeId, pageBodyScope?.id);
  assert.equal(renderRowSymbol?.scopeId, pageBodyScope?.id);
  assert.equal(callbackItemSymbol?.scopeId, callbackParameterScope?.id);
  assert.equal(callbackRowSymbol?.scopeId, callbackBodyScope?.id);
});

test("symbol resolution resolves nested value references by source location", () => {
  const parsedFiles = [
    sourceFile("src/Button.tsx", "export function Button() { return <button />; }"),
    sourceFile(
      "src/Page.tsx",
      [
        'import { Button } from "./Button.tsx";',
        "export function Page({ className }) {",
        "  const Root = Button;",
        "  return <Root className={className} />;",
        "}",
      ].join("\n"),
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });
  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  const rootDeclaration = getSymbolAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 3,
    column: 9,
    symbolSpace: "value",
  });
  const importedButton = resolveReferenceAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 3,
    column: 16,
    symbolSpace: "value",
  });
  const rootReference = resolveReferenceAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 4,
    column: 11,
    symbolSpace: "value",
  });
  const classNameReference = getSymbolReferenceAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 4,
    column: 28,
    symbolSpace: "value",
  });
  const parameterScope = getScopeAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 2,
    column: 24,
  });

  assert.equal(rootDeclaration?.localName, "Root");
  assert.equal(rootDeclaration?.kind, "component");
  assert.equal(importedButton?.localName, "Button");
  assert.equal(importedButton?.resolution.kind, "imported");
  assert.equal(rootReference?.id, rootDeclaration?.id);
  assert.equal(classNameReference?.localName, "className");
  assert.equal(classNameReference?.reason, undefined);
  assert.equal(parameterScope?.kind, "parameter");
});

test("symbol resolution resolves local type references by source location", () => {
  const parsedFiles = [
    sourceFile(
      "src/local.ts",
      [
        'interface ButtonProps { tone?: "primary" | "secondary"; }',
        'type ButtonTone = ButtonProps["tone"];',
      ].join("\n"),
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });
  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  const typeDeclaration = getSymbolAt({
    symbolResolution: resolution,
    filePath: "src/local.ts",
    line: 1,
    column: 12,
    symbolSpace: "type",
  });
  const typeReference = resolveReferenceAt({
    symbolResolution: resolution,
    filePath: "src/local.ts",
    line: 2,
    column: 19,
    symbolSpace: "type",
  });

  assert.equal(typeDeclaration?.localName, "ButtonProps");
  assert.equal(typeDeclaration?.kind, "interface");
  assert.equal(typeReference?.id, typeDeclaration?.id);
});

test("symbol resolution resolves bounded local identifier aliases", () => {
  const parsedFiles = [
    sourceFile("src/Button.tsx", "export function Button() { return <button />; }"),
    sourceFile(
      "src/Page.tsx",
      [
        'import { Button } from "./Button.tsx";',
        "export function Page({ className }) {",
        "  const forwarded = className;",
        "  const Cta = Button;",
        "  return <Cta className={forwarded} />;",
        "}",
      ].join("\n"),
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });
  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  const aliases = getLocalAliasResolutionsForFile({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
  });
  const forwardedAlias = getLocalAliasAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 3,
    column: 9,
  });
  const ctaTarget = resolveLocalAliasAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 4,
    column: 9,
  });

  assert.equal(aliases.filter((alias) => alias.kind === "resolved-alias").length, 2);
  assert.equal(forwardedAlias?.kind, "resolved-alias");
  assert.equal(forwardedAlias?.aliasKind, "identifier");
  assert.equal(ctaTarget?.localName, "Button");
  assert.equal(ctaTarget?.resolution.kind, "imported");
});

test("symbol resolution resolves bounded destructured aliases", () => {
  const parsedFiles = [
    sourceFile(
      "src/Page.tsx",
      [
        "export function Page(props) {",
        "  const { className: fieldClassName, tone } = props;",
        "  return <div className={fieldClassName + tone} />;",
        "}",
      ].join("\n"),
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });
  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  const fieldClassAlias = getLocalAliasAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 2,
    column: 22,
  });
  const toneAlias = getLocalAliasAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 2,
    column: 38,
  });
  const propsTarget = resolveLocalAliasAt({
    symbolResolution: resolution,
    filePath: "src/Page.tsx",
    line: 2,
    column: 22,
  });

  assert.deepEqual(
    {
      kind: fieldClassAlias?.kind,
      aliasKind: fieldClassAlias?.aliasKind,
      memberName: fieldClassAlias?.memberName,
    },
    {
      kind: "resolved-alias",
      aliasKind: "object-destructuring",
      memberName: "className",
    },
  );
  assert.deepEqual(
    {
      kind: toneAlias?.kind,
      aliasKind: toneAlias?.aliasKind,
      memberName: toneAlias?.memberName,
    },
    {
      kind: "resolved-alias",
      aliasKind: "object-destructuring",
      memberName: "tone",
    },
  );
  assert.equal(propsTarget?.localName, "props");
});

test("symbol resolution degrades unsupported local alias destructuring shapes", () => {
  const parsedFiles = [
    sourceFile(
      "src/Page.tsx",
      [
        "export function Page(props) {",
        "  const { nested: { className }, ...rest } = props;",
        "  return <div className={className} data-rest={Boolean(rest)} />;",
        "}",
      ].join("\n"),
    ),
  ];
  const moduleFacts = buildModuleFacts({
    parsedFiles,
  });
  const resolution = buildProjectBindingResolution({
    parsedFiles,
    moduleFacts,
    includeTraces: false,
  });

  assert.deepEqual(
    getLocalAliasResolutionsForFile({
      symbolResolution: resolution,
      filePath: "src/Page.tsx",
    })
      .map((alias) => (alias.kind === "unresolved-alias" ? alias.reason : "resolved"))
      .sort(),
    ["nested-local-destructuring", "rest-local-destructuring"],
  );
});

function sourceFile(filePath, sourceText) {
  return {
    filePath,
    parsedSourceFile: ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  };
}

function expressionText(expression) {
  return expression?.getText();
}

function findCollectedSymbol(symbolResolution, input) {
  return [...symbolResolution.symbols.values()].find(
    (symbol) =>
      symbol.declaration.filePath === input.filePath &&
      symbol.localName === input.localName &&
      symbol.declaration.startLine === input.startLine,
  );
}

function findChildScopeByKind(symbolResolution, parentScopeId, kind) {
  const parentScope = parentScopeId ? symbolResolution.scopes.get(parentScopeId) : undefined;
  if (!parentScope) {
    return undefined;
  }

  return parentScope.childScopeIds
    .map((scopeId) => symbolResolution.scopes.get(scopeId))
    .find((scope) => scope?.kind === kind);
}

function resolveTypeBindingForTest(symbolResolution, filePath, localName) {
  return resolveTypeBinding({
    symbolResolution,
    filePath,
    localName,
  });
}

function resolveCssModuleNamespaceForTest(symbolResolution, filePath, localName) {
  return resolveCssModuleNamespace({
    symbolResolution,
    filePath,
    localName,
  });
}

function resolveCssModuleMemberForTest(symbolResolution, filePath, localName) {
  return resolveCssModuleMember({
    symbolResolution,
    filePath,
    localName,
  });
}

function resolveCssModuleMemberAccessForTest(symbolResolution, filePath, localName, memberName) {
  return resolveCssModuleMemberAccess({
    symbolResolution,
    filePath,
    localName,
    memberName,
  });
}

function resolveExportedTypeBindingForTest(symbolResolution, filePath, exportedName) {
  return resolveExportedTypeBinding({
    symbolResolution,
    filePath,
    exportedName,
  });
}

function resolveTypeDeclarationForTest(parsedFiles, symbolResolution, filePath, localName) {
  const resolvedDeclaration = resolveTypeDeclaration({
    symbolResolution,
    sourceFilesByFilePath: new Map(
      parsedFiles.map((parsedFile) => [parsedFile.filePath, parsedFile.parsedSourceFile]),
    ),
    filePath,
    localName,
  });
  return resolvedDeclaration
    ? {
        kind: resolvedDeclaration.kind,
        declarationText: resolvedDeclaration.declaration.getText(),
        binding: resolvedDeclaration.binding,
      }
    : undefined;
}

function resolveExportedTypeDeclarationForTest(
  parsedFiles,
  symbolResolution,
  filePath,
  exportedName,
) {
  const resolvedDeclaration = resolveExportedTypeDeclaration({
    symbolResolution,
    sourceFilesByFilePath: new Map(
      parsedFiles.map((parsedFile) => [parsedFile.filePath, parsedFile.parsedSourceFile]),
    ),
    filePath,
    exportedName,
  });
  return resolvedDeclaration
    ? {
        kind: resolvedDeclaration.kind,
        declarationText: resolvedDeclaration.declaration.getText(),
        binding: resolvedDeclaration.binding,
      }
    : undefined;
}
