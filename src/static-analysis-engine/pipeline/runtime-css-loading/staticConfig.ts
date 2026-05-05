import path from "node:path";
import ts from "typescript";

import { normalizeProjectPath } from "./pathUtils.js";

export function extractViteRollupInputPaths(sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(
    "vite.config.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const inputPaths = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && getPropertyNameText(node.name) === "rollupOptions") {
      collectInputPathsFromRollupOptions(node.initializer, inputPaths);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return [...inputPaths].sort((left, right) => left.localeCompare(right));
}

export function extractWebpackEntryPaths(
  sourceText: string,
  configFilePath = "webpack.config.js",
): string[] {
  const sourceFile = ts.createSourceFile(
    configFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const entryPaths = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && getPropertyNameText(node.name) === "entry") {
      for (const entryPath of readStaticInputExpressionPaths(node.initializer, configFilePath)) {
        entryPaths.add(entryPath);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return [...entryPaths].sort((left, right) => left.localeCompare(right));
}

function collectInputPathsFromRollupOptions(node: ts.Expression, inputPaths: Set<string>): void {
  const expression = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(expression)) {
    return;
  }

  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || getPropertyNameText(property.name) !== "input") {
      continue;
    }
    for (const inputPath of readStaticInputExpressionPaths(property.initializer)) {
      inputPaths.add(inputPath);
    }
  }
}

function readStaticInputExpressionPaths(node: ts.Expression, configFilePath = "."): string[] {
  const expression = unwrapExpression(node);
  const stringPath = readStaticPathExpression(expression, configFilePath);
  if (stringPath) {
    return [stringPath];
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) =>
      readStaticInputExpressionPaths(element, configFilePath),
    );
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) {
        return [];
      }
      return readStaticInputExpressionPaths(property.initializer, configFilePath);
    });
  }

  return [];
}

function readStaticPathExpression(node: ts.Expression, configFilePath: string): string | undefined {
  const expression = unwrapExpression(node);
  if (ts.isStringLiteralLike(expression)) {
    return normalizeStaticInputPath(expression.text);
  }
  if (ts.isCallExpression(expression)) {
    const dirnameRelativePath = readDirnameRelativeCallPath(expression, configFilePath);
    if (dirnameRelativePath) {
      return dirnameRelativePath;
    }

    const stringArguments = expression.arguments
      .filter(ts.isStringLiteralLike)
      .map((argument) => normalizeStaticInputPath(argument.text))
      .filter(Boolean);
    return stringArguments.at(-1);
  }
  return undefined;
}

function readDirnameRelativeCallPath(
  expression: ts.CallExpression,
  configFilePath: string,
): string | undefined {
  const dirnameArgumentIndex = expression.arguments.findIndex(
    (argument) => ts.isIdentifier(argument) && argument.text === "__dirname",
  );
  if (dirnameArgumentIndex < 0) {
    return undefined;
  }

  const parts = expression.arguments
    .slice(dirnameArgumentIndex + 1)
    .filter(ts.isStringLiteralLike)
    .map((argument) => argument.text);
  if (parts.length === 0) {
    return getProjectDirectory(configFilePath);
  }

  return normalizeProjectPath(path.posix.join(getProjectDirectory(configFilePath), ...parts));
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function normalizeStaticInputPath(inputPath: string): string {
  return normalizeProjectPath(inputPath.replace(/^\.\//, "").replace(/^\/+/, ""));
}

function getProjectDirectory(filePath: string): string {
  const normalized = normalizeProjectPath(filePath);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "." : normalized.slice(0, index);
}
