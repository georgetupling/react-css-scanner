import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { ResolvedReactCssScannerConfig } from "../config/types.js";
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
  const localBindings = new Map<string, ts.Expression>();
  const expressionContext: ExpressionCollectionContext = {
    helperImports,
    localBindings,
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

    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "className") {
      collectClassNameExpressionFacts(node.initializer, classReferences, expressionContext);
      return;
    }

    if (ts.isCallExpression(node)) {
      collectHelperCallFacts(node, expressionContext, classReferences);
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
  context: ExpressionCollectionContext,
): void {
  if (!initializer) {
    return;
  }

  if (ts.isStringLiteral(initializer)) {
    pushTokenFacts(
      initializer.text,
      "string-literal",
      "high",
      initializer,
      context,
      classReferences,
    );
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
  context: ExpressionCollectionContext,
  seenIdentifiers = new Set<string>(),
): void {
  const staticValue = resolveStaticClassValue(expression, context, seenIdentifiers);
  if (staticValue) {
    pushTokenFacts(
      staticValue.value,
      staticValue.kind,
      staticValue.confidence,
      expression,
      context,
      classReferences,
    );
    return;
  }

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    pushTokenFacts(expression.text, "string-literal", "high", expression, context, classReferences);
    return;
  }

  if (ts.isIdentifier(expression)) {
    if (seenIdentifiers.has(expression.text)) {
      return;
    }

    const initializer = context.localBindings.get(expression.text);
    if (!initializer) {
      return;
    }

    seenIdentifiers.add(expression.text);
    collectExpressionFacts(initializer, classReferences, context, seenIdentifiers);
    seenIdentifiers.delete(expression.text);
    return;
  }

  if (ts.isTemplateExpression(expression)) {
    for (const headToken of tokenizeClassNames(expression.head.text)) {
      classReferences.push(
        createClassReferenceFact(expression, context.parsedSourceFile, {
          className: headToken,
          kind: "template-literal",
          confidence: "medium",
          source: expression.getText(),
        }),
      );
    }

    for (const span of expression.templateSpans) {
      collectExpressionFacts(span.expression, classReferences, context, seenIdentifiers);
      for (const literalToken of tokenizeClassNames(span.literal.text)) {
        classReferences.push(
          createClassReferenceFact(expression, context.parsedSourceFile, {
            className: literalToken,
            kind: "template-literal",
            confidence: "medium",
            source: expression.getText(),
          }),
        );
      }
    }
    return;
  }

  if (ts.isConditionalExpression(expression)) {
    collectExpressionFacts(expression.whenTrue, classReferences, context, seenIdentifiers);
    collectExpressionFacts(expression.whenFalse, classReferences, context, seenIdentifiers);
    classReferences.push(
      createClassReferenceFact(expression, context.parsedSourceFile, {
        kind: "conditional",
        confidence: "medium",
        source: expression.getText(),
      }),
    );
    return;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        classReferences.push(
          createClassReferenceFact(expression, context.parsedSourceFile, {
            kind: "helper-call",
            confidence: "low",
            source: expression.getText(),
          }),
        );
        continue;
      }

      collectExpressionFacts(element as ts.Expression, classReferences, context, seenIdentifiers);
    }
    return;
  }

  if (ts.isBinaryExpression(expression)) {
    if (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      collectExpressionFacts(expression.right, classReferences, context, seenIdentifiers);
      classReferences.push(
        createClassReferenceFact(expression, context.parsedSourceFile, {
          kind: "conditional",
          confidence: "medium",
          source: expression.getText(),
        }),
      );
      return;
    }

    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      collectExpressionFacts(expression.left, classReferences, context, seenIdentifiers);
      collectExpressionFacts(expression.right, classReferences, context, seenIdentifiers);
      return;
    }
  }

  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "join" &&
    ts.isArrayLiteralExpression(expression.expression.expression)
  ) {
    for (const element of expression.expression.expression.elements) {
      collectExpressionFacts(element as ts.Expression, classReferences, context, seenIdentifiers);
    }
    return;
  }

  if (ts.isCallExpression(expression)) {
    collectHelperCallFacts(expression, context, classReferences);
  }
}

function collectHelperCallFacts(
  node: ts.CallExpression,
  context: ExpressionCollectionContext,
  classReferences: ClassReferenceFact[],
): void {
  if (!ts.isIdentifier(node.expression) || !context.helperImports.has(node.expression.text)) {
    return;
  }

  for (const argument of node.arguments) {
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      pushTokenFacts(argument.text, "helper-call", "high", argument, context, classReferences);
      continue;
    }

    if (ts.isObjectLiteralExpression(argument)) {
      for (const property of argument.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          classReferences.push(
            createClassReferenceFact(property.name, context.parsedSourceFile, {
              className: ts.isIdentifier(property.name) ? property.name.text : property.name.text,
              kind: "helper-call",
              confidence: "medium",
              source: property.getText(),
            }),
          );
        }
      }
      continue;
    }

    if (ts.isArrayLiteralExpression(argument)) {
      for (const element of argument.elements) {
        if (ts.isExpression(element)) {
          collectExpressionFacts(element, classReferences, context);
        }
      }
      continue;
    }

    classReferences.push(
      createClassReferenceFact(argument, context.parsedSourceFile, {
        kind: "helper-call",
        confidence: "low",
        source: argument.getText(),
      }),
    );
  }
}

function pushTokenFacts(
  value: string,
  kind: ClassReferenceFact["kind"],
  confidence: ClassReferenceFact["confidence"],
  anchorNode: ts.Node,
  context: ExpressionCollectionContext,
  classReferences: ClassReferenceFact[],
): void {
  for (const token of tokenizeClassNames(value)) {
    classReferences.push(
      createClassReferenceFact(anchorNode, context.parsedSourceFile, {
        className: token,
        kind,
        confidence,
        source: value,
      }),
    );
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

type ExpressionCollectionContext = {
  helperImports: Set<string>;
  localBindings: Map<string, ts.Expression>;
  parsedSourceFile: ts.SourceFile;
};

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

function resolveStaticClassValue(
  expression: ts.Expression,
  context: ExpressionCollectionContext,
  seenIdentifiers: Set<string>,
):
  | {
      value: string;
      kind: ClassReferenceFact["kind"];
      confidence: ClassReferenceFact["confidence"];
    }
  | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return {
      value: expression.text,
      kind: "string-literal",
      confidence: "high",
    };
  }

  if (ts.isIdentifier(expression)) {
    if (seenIdentifiers.has(expression.text)) {
      return undefined;
    }

    const initializer = context.localBindings.get(expression.text);
    if (!initializer) {
      return undefined;
    }

    seenIdentifiers.add(expression.text);
    const resolved = resolveStaticClassValue(initializer, context, seenIdentifiers);
    seenIdentifiers.delete(expression.text);
    return resolved;
  }

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;

    for (const span of expression.templateSpans) {
      const resolvedSpan = resolveStaticClassValue(span.expression, context, seenIdentifiers);
      if (!resolvedSpan) {
        return undefined;
      }

      value += resolvedSpan.value;
      value += span.literal.text;
    }

    return {
      value,
      kind: "template-literal",
      confidence: "high",
    };
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStaticClassValue(expression.left, context, seenIdentifiers);
    const right = resolveStaticClassValue(expression.right, context, seenIdentifiers);
    if (!left || !right) {
      return undefined;
    }

    return {
      value: `${left.value}${right.value}`,
      kind: "template-literal",
      confidence: "high",
    };
  }

  if (ts.isParenthesizedExpression(expression)) {
    return resolveStaticClassValue(expression.expression, context, seenIdentifiers);
  }

  return undefined;
}

function isTrackableBinding(node: ts.VariableDeclaration): boolean {
  const list = node.parent;
  if (!ts.isVariableDeclarationList(list)) {
    return false;
  }

  return (list.flags & ts.NodeFlags.Const) !== 0;
}
