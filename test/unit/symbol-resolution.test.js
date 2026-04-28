import assert from "node:assert/strict";
import test from "node:test";

import ts from "typescript";

import {
  buildModuleFacts,
  buildProjectBindingResolution,
  collectTopLevelSymbols,
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

  const symbolsByFilePath = new Map(
    parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectTopLevelSymbols({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
        moduleId: `module:${parsedFile.filePath}`,
        moduleFacts,
      }),
    ]),
  );

  const resolution = buildProjectBindingResolution({
    parsedFiles,
    symbolsByFilePath,
    moduleFacts,
    includeTraces: false,
  });

  assert.deepEqual(
    [...(resolution.exportedExpressionBindingsByFilePath.get("src/tokens.ts") ?? []).keys()],
    ["publicToken", "buttonTokens"],
  );
  assert.equal(
    expressionText(
      resolution.exportedExpressionBindingsByFilePath
        .get("src/defaultIdentifier.ts")
        ?.get("default"),
    ),
    '"default-token"',
  );
  assert.equal(
    expressionText(
      resolution.exportedExpressionBindingsByFilePath
        .get("src/defaultExpression.ts")
        ?.get("default"),
    ),
    '"literal-default"',
  );
  assert.equal(
    expressionText(
      resolution.importedExpressionBindingsByFilePath.get("src/consumer.ts")?.get("publicToken"),
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
