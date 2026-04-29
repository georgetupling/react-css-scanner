import ts from "typescript";

import type {
  RuntimeDomClassSite,
  RuntimeDomClassSiteKind,
  RuntimeDomLibraryHint,
} from "../../types.js";
import type { SourceAnchor } from "../../../../types/core.js";

export type RuntimeDomFrontendAdapterContext = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
};

export function buildRuntimeDomClassSite(input: {
  kind: RuntimeDomClassSiteKind;
  expression: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
  context: RuntimeDomFrontendAdapterContext;
  traceSummary: string;
  adapterName: string;
  runtimeLibraryHint?: RuntimeDomLibraryHint;
}): RuntimeDomClassSite {
  const location = toSourceAnchor(
    input.expression,
    input.context.parsedSourceFile,
    input.context.filePath,
  );

  return {
    kind: input.kind,
    filePath: input.context.filePath,
    location,
    rawExpressionText: input.expression.getText(input.context.parsedSourceFile),
    classText: input.expression.text,
    runtimeLibraryHint: input.runtimeLibraryHint,
    trace: {
      adapterName: input.adapterName,
      summary: input.traceSummary,
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
