import ts from "typescript";

import {
  createCssModuleTrace,
  toSourceAnchor,
} from "../../language-frontends/source/css-module-syntax/shared.js";
import type { ResolvedCssModuleNamespaceBinding } from "../../language-frontends/source/css-module-syntax/types.js";
import type { ProjectEvidenceBuildInput } from "../analysisTypes.js";
import { mergeTraces } from "../internal/shared.js";

export function collectClassNamesBindLocalNames(
  imports: ProjectEvidenceBuildInput["factGraph"]["frontends"]["source"]["files"][number]["moduleSyntax"]["imports"],
): Set<string> {
  const localNames = new Set<string>();
  for (const importSyntax of imports) {
    if (
      importSyntax.importKind !== "source" ||
      (importSyntax.specifier !== "classnames/bind" && importSyntax.specifier !== "classnames")
    ) {
      continue;
    }
    for (const importName of importSyntax.importNames) {
      if (importName.typeOnly) {
        continue;
      }
      if (
        importName.kind === "default" ||
        importName.kind === "namespace" ||
        importName.importedName === "bind"
      ) {
        localNames.add(importName.localName);
      }
    }
  }
  return localNames;
}

export function buildBoundCssModuleHelpers(input: {
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  namespaceBindings: Map<string, ResolvedCssModuleNamespaceBinding>;
  classNamesBindLocalNames: Set<string>;
  includeTraces: boolean;
}): Map<string, ResolvedCssModuleNamespaceBinding> {
  const helpers = new Map<string, ResolvedCssModuleNamespaceBinding>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstVariableDeclaration(node)
    ) {
      const binding = resolveBoundCssModuleHelperBinding({
        initializer: node.initializer,
        namespaceBindings: input.namespaceBindings,
        classNamesBindLocalNames: input.classNamesBindLocalNames,
      });
      if (binding) {
        helpers.set(node.name.text, binding);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(input.parsedSourceFile);
  return new Map([...helpers.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function isConstVariableDeclaration(node: ts.VariableDeclaration): boolean {
  return Boolean(
    ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0,
  );
}

function resolveBoundCssModuleHelperBinding(input: {
  initializer: ts.Expression;
  namespaceBindings: Map<string, ResolvedCssModuleNamespaceBinding>;
  classNamesBindLocalNames: Set<string>;
}): ResolvedCssModuleNamespaceBinding | undefined {
  const initializer = unwrapExpression(input.initializer);
  if (!ts.isCallExpression(initializer) || initializer.arguments.length !== 1) {
    return undefined;
  }

  const callee = unwrapExpression(initializer.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== "bind" ||
    !ts.isIdentifier(callee.expression) ||
    !input.classNamesBindLocalNames.has(callee.expression.text)
  ) {
    return undefined;
  }

  const namespaceArgument = unwrapExpression(initializer.arguments[0]);
  if (!ts.isIdentifier(namespaceArgument)) {
    return undefined;
  }

  return input.namespaceBindings.get(namespaceArgument.text);
}

export function collectBoundCssModuleHelperReferences(input: {
  callExpression: ts.CallExpression;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  binding: ResolvedCssModuleNamespaceBinding;
  includeTraces: boolean;
}): Array<{
  originLocalName: string;
  memberName: string;
  location: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  };
  rawExpressionText: string;
  traces: ReturnType<typeof mergeTraces>;
}> {
  return input.callExpression.arguments.flatMap((argument) =>
    collectBoundCssModuleHelperArgumentReferences({
      expression: argument,
      parsedSourceFile: input.parsedSourceFile,
      sourceFilePath: input.sourceFilePath,
      binding: input.binding,
      includeTraces: input.includeTraces,
    }),
  );
}

function collectBoundCssModuleHelperArgumentReferences(input: {
  expression: ts.Expression;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  binding: ResolvedCssModuleNamespaceBinding;
  includeTraces: boolean;
}): Array<{
  originLocalName: string;
  memberName: string;
  location: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  };
  rawExpressionText: string;
  traces: ReturnType<typeof mergeTraces>;
}> {
  const expression = unwrapExpression(input.expression);
  if (ts.isStringLiteralLike(expression)) {
    return expression.text
      .split(/\s+/)
      .filter(Boolean)
      .map((memberName) =>
        createBoundCssModuleReference({
          node: expression,
          memberName,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          binding: input.binding,
          includeTraces: input.includeTraces,
        }),
      );
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) => {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
        return [];
      }
      return collectBoundCssModuleHelperArgumentReferences({
        ...input,
        expression: element,
      });
    });
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return [];
      }
      const memberName = getStaticPropertyName(property.name);
      if (!memberName) {
        return [];
      }
      return [
        createBoundCssModuleReference({
          node: property.name,
          memberName,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          binding: input.binding,
          includeTraces: input.includeTraces,
        }),
      ];
    });
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...collectBoundCssModuleHelperArgumentReferences({
        ...input,
        expression: expression.whenTrue,
      }),
      ...collectBoundCssModuleHelperArgumentReferences({
        ...input,
        expression: expression.whenFalse,
      }),
    ];
  }

  return [];
}

function createBoundCssModuleReference(input: {
  node: ts.Node;
  memberName: string;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  binding: ResolvedCssModuleNamespaceBinding;
  includeTraces: boolean;
}): {
  originLocalName: string;
  memberName: string;
  location: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  };
  rawExpressionText: string;
  traces: ReturnType<typeof mergeTraces>;
} {
  const location = toSourceAnchor(input.node, input.parsedSourceFile, input.sourceFilePath);
  return {
    originLocalName: input.binding.originLocalName,
    memberName: input.memberName,
    location,
    rawExpressionText: input.node.getText(input.parsedSourceFile),
    traces: input.includeTraces
      ? mergeTraces([
          createCssModuleTrace({
            traceId: `css-module:bound-helper-reference:${location.filePath}:${location.startLine}:${location.startColumn}:${input.memberName}`,
            summary: `CSS Module member "${input.memberName}" was read through bound helper for "${input.binding.originLocalName}"`,
            anchor: location,
            metadata: {
              stylesheetFilePath: input.binding.stylesheetFilePath,
              localName: input.binding.originLocalName,
              memberName: input.memberName,
            },
          }),
        ])
      : [],
  };
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

function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}
