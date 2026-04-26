import ts from "typescript";

import {
  buildClassExpressionTraces,
  summarizeClassNameExpression,
  toAbstractClassSet,
} from "../../render-model/abstract-values/classExpressions.js";
import type {
  RuntimeDomClassReference,
  RuntimeDomClassReferenceKind,
  RuntimeDomAdapterContext,
  RuntimeDomReferenceTrace,
  RuntimeDomReferenceTraceInput,
} from "../types.js";
import type { SourceAnchor } from "../../../types/core.js";

export function buildRuntimeDomClassReference(input: {
  kind: RuntimeDomClassReferenceKind;
  expression: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
  context: RuntimeDomAdapterContext;
  traceSummary: string;
  adapterName: string;
}): RuntimeDomClassReference {
  const sourceAnchor = toSourceAnchor(
    input.expression,
    input.context.parsedSourceFile,
    input.context.filePath,
  );
  const sourceText = input.expression.getText(input.context.parsedSourceFile);
  const value = summarizeClassNameExpression(input.expression);

  return {
    kind: input.kind,
    filePath: input.context.filePath,
    location: sourceAnchor,
    rawExpressionText: sourceText,
    classExpression: {
      sourceAnchor,
      sourceText,
      value,
      classes: toAbstractClassSet(value, sourceAnchor),
      traces: [
        ...buildRuntimeDomClassReferenceTraces({
          sourceAnchor,
          includeTraces: input.context.includeTraces,
          summary: input.traceSummary,
          adapterName: input.adapterName,
        }),
        ...buildClassExpressionTraces({
          sourceAnchor,
          sourceText,
          value,
          includeTraces: input.context.includeTraces,
        }),
      ],
    },
  };
}

export function findObjectPropertyValue(
  objectExpression: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | undefined {
  for (const property of objectExpression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    if (getObjectPropertyName(property.name) === propertyName) {
      return property.initializer;
    }
  }

  return undefined;
}

export function isStaticStringExpression(
  expression: ts.Expression,
): expression is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression);
}

function buildRuntimeDomClassReferenceTraces(
  input: RuntimeDomReferenceTraceInput,
): RuntimeDomReferenceTrace[] {
  if (!input.includeTraces) {
    return [];
  }

  return [
    {
      traceId: `runtime-dom:class-reference:${input.sourceAnchor.filePath}:${input.sourceAnchor.startLine}:${input.sourceAnchor.startColumn}`,
      category: "value-evaluation",
      summary: input.summary,
      anchor: input.sourceAnchor,
      children: [],
      metadata: {
        adapter: input.adapterName,
      },
    },
  ];
}

function getObjectPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function toSourceAnchor(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): SourceAnchor {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

  return {
    filePath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}
