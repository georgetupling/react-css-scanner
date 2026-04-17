import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { ResolvedReactCssScannerConfig } from "../config/types.js";
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
    config: ResolvedReactCssScannerConfig;
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
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "className") {
      collectClassNameExpressionFacts(node.initializer, classReferences);
      return;
    }

    if (ts.isCallExpression(node)) {
      collectHelperCallFacts(node, helperImports, classReferences);
      return;
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (cssModuleLocalNames.has(node.expression.text)) {
        classReferences.push({
          className: node.name.text,
          kind: "css-module-property",
          confidence: "high",
          source: node.getText(parsed),
          metadata: {
            moduleLocalName: node.expression.text,
          },
        });
      }
      return;
    }

    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (cssModuleLocalNames.has(node.expression.text)) {
        const argument = node.argumentExpression;
        classReferences.push({
          className: argument && ts.isStringLiteral(argument) ? argument.text : undefined,
          kind: "css-module-dynamic-property",
          confidence: argument && ts.isStringLiteral(argument) ? "medium" : "low",
          source: node.getText(parsed),
          metadata: {
            moduleLocalName: node.expression.text,
          },
        });
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
): void {
  if (!initializer) {
    return;
  }

  if (ts.isStringLiteral(initializer)) {
    pushTokenFacts(initializer.text, "string-literal", "high", classReferences);
    return;
  }

  if (!ts.isJsxExpression(initializer) || !initializer.expression) {
    return;
  }

  collectExpressionFacts(initializer.expression, classReferences);
}

function collectExpressionFacts(
  expression: ts.Expression,
  classReferences: ClassReferenceFact[],
): void {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    pushTokenFacts(expression.text, "string-literal", "high", classReferences);
    return;
  }

  if (ts.isTemplateExpression(expression)) {
    for (const headToken of tokenizeClassNames(expression.head.text)) {
      classReferences.push({
        className: headToken,
        kind: "template-literal",
        confidence: "medium",
        source: expression.getText(),
      });
    }

    for (const span of expression.templateSpans) {
      collectExpressionFacts(span.expression, classReferences);
      for (const literalToken of tokenizeClassNames(span.literal.text)) {
        classReferences.push({
          className: literalToken,
          kind: "template-literal",
          confidence: "medium",
          source: expression.getText(),
        });
      }
    }
    return;
  }

  if (ts.isConditionalExpression(expression)) {
    collectExpressionFacts(expression.whenTrue, classReferences);
    collectExpressionFacts(expression.whenFalse, classReferences);
    classReferences.push({
      kind: "conditional",
      confidence: "medium",
      source: expression.getText(),
    });
    return;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        classReferences.push({
          kind: "helper-call",
          confidence: "low",
          source: expression.getText(),
        });
        continue;
      }

      collectExpressionFacts(element as ts.Expression, classReferences);
    }
    return;
  }

  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "join" &&
    ts.isArrayLiteralExpression(expression.expression.expression)
  ) {
    for (const element of expression.expression.expression.elements) {
      collectExpressionFacts(element as ts.Expression, classReferences);
    }
    return;
  }
}

function collectHelperCallFacts(
  node: ts.CallExpression,
  helperImports: Set<string>,
  classReferences: ClassReferenceFact[],
): void {
  if (!ts.isIdentifier(node.expression) || !helperImports.has(node.expression.text)) {
    return;
  }

  for (const argument of node.arguments) {
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      pushTokenFacts(argument.text, "helper-call", "high", classReferences);
      continue;
    }

    if (ts.isObjectLiteralExpression(argument)) {
      for (const property of argument.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          classReferences.push({
            className: ts.isIdentifier(property.name) ? property.name.text : property.name.text,
            kind: "helper-call",
            confidence: "medium",
            source: property.getText(),
          });
        }
      }
      continue;
    }

    if (ts.isArrayLiteralExpression(argument)) {
      for (const element of argument.elements) {
        if (ts.isExpression(element)) {
          collectExpressionFacts(element, classReferences);
        }
      }
      continue;
    }

    classReferences.push({
      kind: "helper-call",
      confidence: "low",
      source: argument.getText(),
    });
  }
}

function pushTokenFacts(
  value: string,
  kind: ClassReferenceFact["kind"],
  confidence: ClassReferenceFact["confidence"],
  classReferences: ClassReferenceFact[],
): void {
  for (const token of tokenizeClassNames(value)) {
    classReferences.push({
      className: token,
      kind,
      confidence,
      source: value,
    });
  }
}

function tokenizeClassNames(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile();
  } catch {
    return false;
  }
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
