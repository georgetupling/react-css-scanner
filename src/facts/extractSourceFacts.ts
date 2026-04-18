import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  evaluateClassExpression,
  type ClassExpressionEvaluationContext,
  type LocalFunctionBinding,
} from "../class-expression-evaluator/index.js";
import type { ResolvedScanReactCssConfig } from "../config/types.js";
import { fileExists } from "../files/fsUtils.js";
import { isCssFilePath } from "../files/pathUtils.js";
import type { DiscoveredProjectFile } from "../files/types.js";
import type {
  ClassReferenceFact,
  CssModuleImportFact,
  SourceFileFact,
  SourceImportFact,
} from "./types.js";

const BUILT_IN_HELPERS = new Set(["classnames", "clsx"]);

export async function extractSourceFileFacts(
  sourceFile: DiscoveredProjectFile,
  options: {
    rootDir: string;
    config: ResolvedScanReactCssConfig;
  },
): Promise<SourceFileFact> {
  const content = await readFile(sourceFile.absolutePath, "utf8");
  const parsed = ts.createSourceFile(
    sourceFile.absolutePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(sourceFile.absolutePath),
  );

  const imports: SourceImportFact[] = [];
  const cssModuleImports: CssModuleImportFact[] = [];
  const classReferences: ClassReferenceFact[] = [];
  const helperImports = new Set<string>();
  const cssModuleLocalNames = new Set<string>();
  const localBindings = new Map<string, ts.Expression>();
  const localFunctions = new Map<string, LocalFunctionBinding>();
  const expressionContext: ClassExpressionEvaluationContext = {
    helperImports,
    localBindings,
    localFunctions,
    parsedSourceFile: parsed,
  };

  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier) {
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const specifier = statement.moduleSpecifier.text;
        const resolvedPath = await resolveImportSpecifier(
          sourceFile.absolutePath,
          specifier,
          options.rootDir,
        );
        const isRelative = specifier.startsWith(".") || specifier.startsWith("/");

        imports.push({
          specifier,
          kind: "source",
          isRelative,
          resolvedPath,
        });
      }

      continue;
    }

    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    const resolvedPath = await resolveImportSpecifier(
      sourceFile.absolutePath,
      specifier,
      options.rootDir,
    );
    const isRelative = specifier.startsWith(".") || specifier.startsWith("/");

    if (isCssFilePath(specifier)) {
      const isCssModule = specifier.endsWith(".module.css");

      const importClause = statement.importClause;
      if (isCssModule && importClause?.name) {
        cssModuleImports.push({
          specifier,
          localName: importClause.name.text,
          resolvedPath,
        });
        cssModuleLocalNames.add(importClause.name.text);
      } else {
        imports.push({
          specifier,
          kind: isRelative ? "css" : "external-css",
          isRelative,
          resolvedPath,
        });
      }

      continue;
    }

    imports.push({
      specifier,
      kind: "source",
      isRelative,
      resolvedPath,
    });

    const importClause = statement.importClause;
    if (
      !BUILT_IN_HELPERS.has(specifier) &&
      !options.config.classComposition.helpers.includes(specifier)
    ) {
      continue;
    }

    if (importClause?.name) {
      helperImports.add(importClause.name.text);
    }

    if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        helperImports.add(element.name.text);
      }
    }
  }

  walk(parsed, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isTrackableBinding(node)
    ) {
      localBindings.set(node.name.text, node.initializer);
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const bodyExpression = getFunctionBodyExpression(node);
      if (bodyExpression) {
        localFunctions.set(node.name.text, {
          bodyExpression,
          parameters: node.parameters,
        });
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isTrackableBinding(node) &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const bodyExpression = getFunctionBodyExpression(node.initializer);
      if (bodyExpression) {
        localFunctions.set(node.name.text, {
          bodyExpression,
          parameters: node.initializer.parameters,
        });
      }
    }

    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "className") {
      collectClassNameExpressionFacts(node.initializer, classReferences, expressionContext);
      return;
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (cssModuleLocalNames.has(node.expression.text)) {
        classReferences.push(
          createClassReferenceFact(node, parsed, {
            className: node.name.text,
            kind: "css-module-property",
            confidence: "high",
            source: node.getText(parsed),
            metadata: {
              moduleLocalName: node.expression.text,
            },
          }),
        );
      }
      return;
    }

    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (cssModuleLocalNames.has(node.expression.text)) {
        const argument = node.argumentExpression;
        classReferences.push(
          createClassReferenceFact(node, parsed, {
            className: argument && ts.isStringLiteral(argument) ? argument.text : undefined,
            kind: "css-module-dynamic-property",
            confidence: argument && ts.isStringLiteral(argument) ? "medium" : "low",
            source: node.getText(parsed),
            metadata: {
              moduleLocalName: node.expression.text,
            },
          }),
        );
      }
    }
  });

  return {
    filePath: sourceFile.relativePath,
    imports: sortImports(imports),
    cssModuleImports: cssModuleImports.sort((left, right) =>
      left.localName.localeCompare(right.localName),
    ),
    classReferences: sortClassReferences(classReferences),
    helperImports: [...helperImports].sort(),
  };
}

function collectClassNameExpressionFacts(
  initializer: ts.JsxAttribute["initializer"],
  classReferences: ClassReferenceFact[],
  context: ClassExpressionEvaluationContext,
): void {
  if (!initializer) {
    return;
  }

  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
    collectExpressionFacts(initializer, classReferences, context);
    return;
  }

  if (!ts.isJsxExpression(initializer) || !initializer.expression) {
    return;
  }

  collectExpressionFacts(initializer.expression, classReferences, context);
}

function collectExpressionFacts(
  expression: ts.Expression,
  classReferences: ClassReferenceFact[],
  context: ClassExpressionEvaluationContext,
): void {
  const evaluation = evaluateClassExpression(expression, context);

  for (const token of evaluation.tokens) {
    classReferences.push(
      createClassReferenceFact(token.anchorNode, context.parsedSourceFile, {
        className: token.token,
        kind: token.kind,
        confidence: token.confidence,
        source: token.source,
        metadata: {
          certainty: token.certainty,
        },
      }),
    );
  }

  for (const dynamicExpression of evaluation.dynamics) {
    classReferences.push(
      createClassReferenceFact(dynamicExpression.anchorNode, context.parsedSourceFile, {
        kind: dynamicExpression.kind,
        confidence: dynamicExpression.confidence,
        source: dynamicExpression.source,
      }),
    );
  }
}

async function resolveImportSpecifier(
  sourceFilePath: string,
  specifier: string,
  rootDir: string,
): Promise<string | undefined> {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const basePath = path.resolve(path.dirname(sourceFilePath), specifier);
    const resolvedPath = await resolveRelativeImportPath(basePath);

    if (!resolvedPath) {
      return path.relative(rootDir, basePath).split(path.sep).join("/");
    }

    return path.relative(rootDir, resolvedPath).split(path.sep).join("/");
  }

  const nodeModulesMatch = path.join(rootDir, "node_modules", specifier);
  return nodeModulesMatch.split(path.sep).join("/");
}

async function resolveRelativeImportPath(basePath: string): Promise<string | undefined> {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.css`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (filePath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (filePath.endsWith(".ts")) {
    return ts.ScriptKind.TS;
  }

  return ts.ScriptKind.JS;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function sortImports(imports: SourceImportFact[]): SourceImportFact[] {
  return [...imports].sort((left, right) => {
    if (left.kind === right.kind) {
      return left.specifier.localeCompare(right.specifier);
    }

    return left.kind.localeCompare(right.kind);
  });
}

function sortClassReferences(classReferences: ClassReferenceFact[]): ClassReferenceFact[] {
  return [...classReferences].sort((left, right) => {
    const leftName = left.className ?? "";
    const rightName = right.className ?? "";

    if (leftName === rightName) {
      return left.kind.localeCompare(right.kind);
    }

    return leftName.localeCompare(rightName);
  });
}

function createClassReferenceFact(
  node: ts.Node,
  parsedSourceFile: ts.SourceFile,
  input: Omit<ClassReferenceFact, "line" | "column">,
): ClassReferenceFact {
  const start = node.getStart(parsedSourceFile);
  const position = ts.getLineAndCharacterOfPosition(parsedSourceFile, start);

  return {
    ...input,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function isTrackableBinding(node: ts.VariableDeclaration): boolean {
  const list = node.parent;
  if (!ts.isVariableDeclarationList(list)) {
    return false;
  }

  return (list.flags & ts.NodeFlags.Const) !== 0;
}

function getFunctionBodyExpression(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): ts.Expression | undefined {
  if (ts.isArrowFunction(node) && ts.isExpression(node.body)) {
    return node.body;
  }

  if (!node.body || !ts.isBlock(node.body) || node.body.statements.length !== 1) {
    return undefined;
  }

  const [statement] = node.body.statements;
  if (!ts.isReturnStatement(statement) || !statement.expression) {
    return undefined;
  }

  return statement.expression;
}
