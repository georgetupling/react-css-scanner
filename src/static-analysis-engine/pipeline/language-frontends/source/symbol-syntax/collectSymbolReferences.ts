import ts from "typescript";

import type { EngineSymbolId } from "../../../../types/core.js";
import type {
  EngineSymbol,
  ScopeId,
  SourceScope,
  SymbolReference,
  SymbolSpace,
} from "../../../symbol-resolution/types.js";
import { toSourceAnchor } from "./shared.js";

export function collectSymbolReferences(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  symbols: Map<EngineSymbolId, EngineSymbol>;
  scopes: Map<ScopeId, SourceScope>;
}): SymbolReference[] {
  const references: SymbolReference[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbolSpace = classifyIdentifierSymbolSpace(node);
      if (symbolSpace) {
        const location = toSourceAnchor(node, input.parsedSourceFile, input.filePath);
        const scope = findInnermostScopeAt({
          scopes: input.scopes,
          filePath: input.filePath,
          line: location.startLine,
          column: location.startColumn,
        });
        const resolvedSymbol = scope
          ? resolveSymbolFromScope({
              symbols: input.symbols,
              scopes: input.scopes,
              scopeId: scope.id,
              localName: node.text,
              symbolSpace,
            })
          : undefined;
        references.push({
          filePath: input.filePath,
          localName: node.text,
          location,
          symbolSpace,
          scopeId: scope?.id,
          resolvedSymbolId: resolvedSymbol?.id,
          reason: resolvedSymbol ? undefined : "binding-not-found",
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(input.parsedSourceFile);
  return references;
}

export function findInnermostScopeAt(input: {
  scopes: Map<ScopeId, SourceScope>;
  filePath: string;
  line: number;
  column: number;
}): SourceScope | undefined {
  let bestScope: SourceScope | undefined;

  for (const scope of input.scopes.values()) {
    if (scope.filePath !== input.filePath) {
      continue;
    }

    if (!containsPosition(scope.range, input.line, input.column)) {
      continue;
    }

    if (!bestScope || compareScopeSpecificity(scope, bestScope, input.scopes) < 0) {
      bestScope = scope;
    }
  }

  return bestScope;
}

export function resolveSymbolFromScope(input: {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  scopes: Map<ScopeId, SourceScope>;
  scopeId: ScopeId;
  localName: string;
  symbolSpace: SymbolSpace;
}): EngineSymbol | undefined {
  let currentScopeId: ScopeId | undefined = input.scopeId;

  while (currentScopeId) {
    const currentScope = input.scopes.get(currentScopeId);
    if (!currentScope) {
      break;
    }

    for (let index = currentScope.declaredSymbolIds.length - 1; index >= 0; index -= 1) {
      const symbol = input.symbols.get(currentScope.declaredSymbolIds[index]);
      if (
        !symbol ||
        symbol.localName !== input.localName ||
        symbol.symbolSpace !== input.symbolSpace
      ) {
        continue;
      }

      return symbol;
    }

    currentScopeId = currentScope.parentScopeId;
  }

  return undefined;
}

function classifyIdentifierSymbolSpace(node: ts.Identifier): SymbolSpace | undefined {
  if (isDeclarationIdentifier(node) || isNonReferenceIdentifier(node)) {
    return undefined;
  }

  return isTypePosition(node) ? "type" : "value";
}

function isDeclarationIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;

  return (
    (ts.isVariableDeclaration(parent) && containsNode(parent.name, node)) ||
    (ts.isParameter(parent) && containsNode(parent.name, node)) ||
    ((ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isModuleDeclaration(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isNamespaceImport(parent) && parent.name === node) ||
    (ts.isImportEqualsDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isShorthandPropertyAssignment(parent) && parent.name !== node) ||
    (ts.isJsxAttribute(parent) && parent.name === node) ||
    (ts.isExportSpecifier(parent) && (parent.name === node || parent.propertyName === node))
  );
}

function isNonReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;

  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    (ts.isJsxClosingElement(parent) && parent.tagName === node) ||
    ts.isBreakOrContinueStatement(parent) ||
    ts.isLabeledStatement(parent)
  );
}

function isTypePosition(node: ts.Identifier): boolean {
  let current: ts.Node = node;

  while (current.parent) {
    const parent = current.parent;

    if (ts.isTypeQueryNode(parent) && parent.exprName === current) {
      return false;
    }

    if (ts.isExpressionWithTypeArguments(parent) && parent.expression === current) {
      return false;
    }

    if (ts.isTypeNode(parent)) {
      return true;
    }

    if (
      ts.isExpression(parent) ||
      ts.isStatement(parent) ||
      ts.isJsxExpression(parent) ||
      ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isSourceFile(parent)
    ) {
      return false;
    }

    current = parent;
  }

  return false;
}

function containsNode(root: ts.Node, target: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (node === target) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function containsPosition(anchor: SourceScope["range"], line: number, column: number): boolean {
  const afterStart =
    line > anchor.startLine || (line === anchor.startLine && column >= anchor.startColumn);
  const beforeEnd =
    (anchor.endLine ?? anchor.startLine) > line ||
    ((anchor.endLine ?? anchor.startLine) === line &&
      column <= (anchor.endColumn ?? anchor.startColumn));

  return afterStart && beforeEnd;
}

function compareScopeSpecificity(
  left: SourceScope,
  right: SourceScope,
  scopes: Map<ScopeId, SourceScope>,
): number {
  const leftSpan = spanSize(left.range);
  const rightSpan = spanSize(right.range);

  if (leftSpan !== rightSpan) {
    return leftSpan - rightSpan;
  }

  const depthDelta = scopeDepth(scopes, right.id) - scopeDepth(scopes, left.id);
  if (depthDelta !== 0) {
    return depthDelta;
  }

  return left.id.localeCompare(right.id);
}

function spanSize(anchor: SourceScope["range"]): number {
  return (
    ((anchor.endLine ?? anchor.startLine) - anchor.startLine) * 10000 +
    ((anchor.endColumn ?? anchor.startColumn) - anchor.startColumn)
  );
}

function scopeDepth(scopes: Map<ScopeId, SourceScope>, scopeId: ScopeId): number {
  let depth = 0;
  let currentScopeId: ScopeId | undefined = scopeId;

  while (currentScopeId) {
    const scope = scopes.get(currentScopeId);
    if (!scope?.parentScopeId) {
      break;
    }
    depth += 1;
    currentScopeId = scope.parentScopeId;
  }

  return depth;
}
