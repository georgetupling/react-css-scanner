import ts from "typescript";

import type {
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleMemberReference,
  ResolvedCssModuleNamespaceBinding,
} from "./types.js";
import { createCssModuleDiagnostic, createCssModuleTrace, toSourceAnchor } from "./shared.js";

export type CssModuleMemberAccess =
  | { kind: "reference"; reference: ResolvedCssModuleMemberReference }
  | { kind: "diagnostic"; diagnostic: ResolvedCssModuleBindingDiagnostic };

export function getCssModuleMemberAccess(input: {
  node: ts.Node;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  namespaceBindings: Map<string, ResolvedCssModuleNamespaceBinding>;
  includeTraces: boolean;
}): CssModuleMemberAccess | undefined {
  if (ts.isPropertyAccessExpression(input.node) && ts.isIdentifier(input.node.expression)) {
    const namespaceBinding = input.namespaceBindings.get(input.node.expression.text);
    if (!namespaceBinding) {
      return undefined;
    }

    const location = toSourceAnchor(input.node, input.parsedSourceFile, input.sourceFilePath);
    return {
      kind: "reference",
      reference: {
        sourceFilePath: input.sourceFilePath,
        stylesheetFilePath: namespaceBinding.stylesheetFilePath,
        specifier: namespaceBinding.specifier,
        localName: namespaceBinding.localName,
        originLocalName: namespaceBinding.originLocalName,
        memberName: input.node.name.text,
        accessKind: "property",
        location,
        rawExpressionText: input.node.getText(input.parsedSourceFile),
        traces: input.includeTraces
          ? [
              createCssModuleTrace({
                traceId: `css-module:member-reference:${location.filePath}:${location.startLine}:${location.startColumn}`,
                summary: `CSS Module member "${input.node.name.text}" was read from binding "${namespaceBinding.localName}"`,
                anchor: location,
                metadata: {
                  stylesheetFilePath: namespaceBinding.stylesheetFilePath,
                  localName: namespaceBinding.localName,
                  memberName: input.node.name.text,
                },
              }),
            ]
          : [],
      },
    };
  }

  if (ts.isElementAccessExpression(input.node) && ts.isIdentifier(input.node.expression)) {
    const namespaceBinding = input.namespaceBindings.get(input.node.expression.text);
    if (!namespaceBinding) {
      return undefined;
    }

    const location = toSourceAnchor(input.node, input.parsedSourceFile, input.sourceFilePath);
    const resolvedMemberName = resolveStaticStringExpression(
      input.node.argumentExpression,
      input.parsedSourceFile,
    );
    if (resolvedMemberName) {
      return {
        kind: "reference",
        reference: {
          sourceFilePath: input.sourceFilePath,
          stylesheetFilePath: namespaceBinding.stylesheetFilePath,
          specifier: namespaceBinding.specifier,
          localName: namespaceBinding.localName,
          originLocalName: namespaceBinding.originLocalName,
          memberName: resolvedMemberName,
          accessKind: "string-literal-element",
          location,
          rawExpressionText: input.node.getText(input.parsedSourceFile),
          traces: input.includeTraces
            ? [
                createCssModuleTrace({
                  traceId: `css-module:member-reference:${location.filePath}:${location.startLine}:${location.startColumn}`,
                  summary: `CSS Module member "${resolvedMemberName}" was read from binding "${namespaceBinding.localName}"`,
                  anchor: location,
                  metadata: {
                    stylesheetFilePath: namespaceBinding.stylesheetFilePath,
                    localName: namespaceBinding.localName,
                    memberName: resolvedMemberName,
                  },
                }),
              ]
            : [],
        },
      };
    }

    return {
      kind: "diagnostic",
      diagnostic: createCssModuleDiagnostic({
        reason: "computed-css-module-member",
        node: input.node,
        parsedSourceFile: input.parsedSourceFile,
        sourceFilePath: input.sourceFilePath,
        binding: namespaceBinding,
        summary:
          "CSS Module member access used a computed expression that cannot be resolved statically",
        includeTraces: input.includeTraces,
      }),
    };
  }

  return undefined;
}

function resolveStaticStringExpression(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!expression) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrapped)) {
    return unwrapped.text;
  }

  if (!ts.isIdentifier(unwrapped)) {
    return undefined;
  }

  const binding = findConstStringBinding({
    sourceFile,
    identifierName: unwrapped.text,
    targetPosition: unwrapped.getStart(sourceFile),
  });
  return binding ? resolveStaticStringExpression(binding.initializer, sourceFile) : undefined;
}

function findConstStringBinding(input: {
  sourceFile: ts.SourceFile;
  identifierName: string;
  targetPosition: number;
}): { initializer: ts.Expression } | undefined {
  const bindings: Array<{ initializer: ts.Expression; position: number }> = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === input.identifierName &&
      node.initializer &&
      isConstVariableDeclaration(node) &&
      node.getStart(input.sourceFile) <= input.targetPosition
    ) {
      bindings.push({
        initializer: node.initializer,
        position: node.getStart(input.sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(input.sourceFile);
  return bindings.sort((left, right) => right.position - left.position)[0];
}

function isConstVariableDeclaration(node: ts.VariableDeclaration): boolean {
  return Boolean(
    ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0,
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
