import ts from "typescript";

import type { SourceAnchor } from "../../types/core.js";

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

export function isExported(
  statement: ts.Statement & {
    modifiers?: ts.NodeArray<ts.ModifierLike>;
  },
): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

export function isClassComponentLike(declaration: ts.ClassDeclaration): boolean {
  const heritageClauses = declaration.heritageClauses ?? [];
  for (const heritageClause of heritageClauses) {
    if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }

    for (const typeNode of heritageClause.types) {
      const expression = typeNode.expression;
      if (
        ts.isIdentifier(expression) &&
        (expression.text === "Component" || expression.text === "PureComponent")
      ) {
        return true;
      }
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "React" &&
        (expression.name.text === "Component" || expression.name.text === "PureComponent")
      ) {
        return true;
      }
    }
  }

  return false;
}

export function findFunctionLikeAnchorNode(
  functionLikeNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): ts.Node | undefined {
  if (ts.isFunctionDeclaration(functionLikeNode) || ts.isFunctionExpression(functionLikeNode)) {
    return functionLikeNode.name;
  }

  return undefined;
}

export function toSourceAnchor(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
): SourceAnchor {
  const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

  return {
    filePath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

export function withTextRange<T extends ts.Node>(node: T, anchorNode: ts.Node): T {
  return ts.setTextRange(node, anchorNode);
}
