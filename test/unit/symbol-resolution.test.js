import assert from "node:assert/strict";
import test from "node:test";

import ts from "typescript";

import {
  buildModuleFacts,
  buildProjectBindingResolution,
  collectTopLevelSymbols,
  getExportedExpressionBindingsForFile,
  getCssModuleBindingsForFile,
  getImportedComponentBindingsForFile,
  getImportedExpressionBindingsForFile,
  getNamespaceImportsForFile,
  getSymbol,
  resolveCssModuleMember,
  resolveCssModuleMemberAccess,
  resolveCssModuleNamespace,
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
  assert.equal(
    expressionText(
      getImportedExpressionBindingsForFile({
        symbolResolution: resolution,
        filePath: "src/consumer.ts",
      }).get("publicToken"),
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

  const symbols = collectTopLevelSymbols({
    filePath: "src/library.tsx",
    parsedSourceFile: parsedFiles[0].parsedSourceFile,
    moduleId: "module:src/library.tsx",
    moduleFacts,
  });
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

  const sourceSymbols = collectTopLevelSymbols({
    filePath: "src/components.tsx",
    parsedSourceFile: parsedFiles[0].parsedSourceFile,
    moduleId: "module:src/components.tsx",
    moduleFacts,
  });
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
  assert.equal(namespaceImport?.localName, "api");
  assert.deepEqual([...(namespaceImport?.members.keys() ?? [])], ["broken", "ok"]);
  assert.deepEqual(namespaceImport?.members.get("ok"), {
    kind: "resolved",
    target: {
      targetModuleId: "module:src/source.ts",
      targetFilePath: "src/source.ts",
      targetExportName: "ok",
      targetSymbolId: "symbol:module:src/source.ts:ok",
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

  assert.deepEqual(resolveTypeBindingForTest(resolution, "src/consumer.ts", "ButtonProps"), {
    localName: "ButtonProps",
    targetModuleId: "module:src/types.ts",
    targetFilePath: "src/types.ts",
    targetTypeName: "ButtonProps",
    targetSymbolId: "symbol:module:src/types.ts:ButtonProps",
    traces: [],
  });
  assert.deepEqual(resolveTypeBindingForTest(resolution, "src/consumer.ts", "Tone"), {
    localName: "Tone",
    targetModuleId: "module:src/types.ts",
    targetFilePath: "src/types.ts",
    targetTypeName: "ButtonVariant",
    targetSymbolId: "symbol:module:src/types.ts:ButtonVariant",
    traces: [],
  });
  assert.deepEqual(
    resolveExportedTypeBindingForTest(resolution, "src/barrel.ts", "ExportedVariant"),
    {
      localName: "ExportedVariant",
      targetModuleId: "module:src/types.ts",
      targetFilePath: "src/types.ts",
      targetTypeName: "ButtonVariant",
      targetSymbolId: "symbol:module:src/types.ts:ButtonVariant",
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
        targetSymbolId: "symbol:module:src/types.ts:ButtonProps",
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
        targetSymbolId: "symbol:module:src/types.ts:ButtonVariant",
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

  assert.deepEqual(resolveTypeBindingForTest(resolution, "src/local.ts", "LocalTone"), {
    localName: "LocalTone",
    targetModuleId: "module:src/local.ts",
    targetFilePath: "src/local.ts",
    targetTypeName: "LocalTone",
    targetSymbolId: "symbol:module:src/local.ts:LocalTone",
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
        targetSymbolId: "symbol:module:src/local.ts:LocalProps",
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
  assert.equal(localTypeSymbol?.id, "symbol:module:src/local.ts:LocalProps");
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
