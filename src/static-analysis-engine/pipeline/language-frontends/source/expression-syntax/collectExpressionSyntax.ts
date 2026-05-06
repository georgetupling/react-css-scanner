import ts from "typescript";

import { toSourceAnchor } from "../../../../libraries/react-components/reactComponentAstUtils.js";
import { createExpressionSyntaxId } from "./ids.js";
import type {
  SourceBinaryExpressionSyntax,
  SourceExpressionSyntaxFact,
  SourceObjectExpressionProperty,
  SourcePrefixUnaryExpressionSyntax,
  SourceTemplateExpressionSpan,
  SourceWrapperExpressionSyntax,
} from "./types.js";

export type CollectedExpressionSyntax = {
  rootExpressionId: string;
  expressions: SourceExpressionSyntaxFact[];
};

export function collectExpressionSyntaxForNode(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
}): CollectedExpressionSyntax {
  const expressionsById = new Map<string, SourceExpressionSyntaxFact>();

  const rootExpressionId = collectExpression(input.node, expressionsById, {
    filePath: input.filePath,
    sourceFile: input.sourceFile,
  });

  return {
    rootExpressionId,
    expressions: sortExpressionSyntaxFacts([...expressionsById.values()]),
  };
}

export function dedupeExpressionSyntaxFacts(
  expressions: SourceExpressionSyntaxFact[],
): SourceExpressionSyntaxFact[] {
  const byId = new Map<string, SourceExpressionSyntaxFact>();
  for (const expression of expressions) {
    byId.set(expression.expressionId, expression);
  }

  return sortExpressionSyntaxFacts([...byId.values()]);
}

export function sortExpressionSyntaxFacts(
  expressions: SourceExpressionSyntaxFact[],
): SourceExpressionSyntaxFact[] {
  return [...expressions].sort((left, right) =>
    left.expressionId.localeCompare(right.expressionId),
  );
}

function collectExpression(
  node: ts.Node,
  expressionsById: Map<string, SourceExpressionSyntaxFact>,
  context: {
    filePath: string;
    sourceFile: ts.SourceFile;
  },
): string {
  const location = toSourceAnchor(node, context.sourceFile, context.filePath);
  const rawText = node.getText(context.sourceFile);
  const expressionId = createExpressionSyntaxId({
    location,
    discriminator: ts.SyntaxKind[node.kind],
  });

  if (expressionsById.has(expressionId)) {
    return expressionId;
  }

  const base = {
    expressionId,
    filePath: context.filePath,
    location,
    rawText,
  };

  const expression = buildExpressionSyntaxFact(node, base, expressionsById, context);
  expressionsById.set(expressionId, expression);
  return expressionId;
}

function buildExpressionSyntaxFact(
  node: ts.Node,
  base: Pick<SourceExpressionSyntaxFact, "expressionId" | "filePath" | "location" | "rawText">,
  expressionsById: Map<string, SourceExpressionSyntaxFact>,
  context: {
    filePath: string;
    sourceFile: ts.SourceFile;
  },
): SourceExpressionSyntaxFact {
  if (ts.isStringLiteral(node)) {
    return {
      ...base,
      expressionKind: "string-literal",
      literalKind: "string",
      value: node.text,
    };
  }

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return {
      ...base,
      expressionKind: "string-literal",
      literalKind: "no-substitution-template",
      value: node.text,
    };
  }

  if (ts.isNumericLiteral(node)) {
    return {
      ...base,
      expressionKind: "numeric-literal",
      value: node.text,
    };
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return {
      ...base,
      expressionKind: "boolean-literal",
      value: node.kind === ts.SyntaxKind.TrueKeyword,
    };
  }

  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword) {
    return {
      ...base,
      expressionKind: "nullish-literal",
      value: node.kind === ts.SyntaxKind.NullKeyword ? "null" : "undefined",
    };
  }

  if (ts.isIdentifier(node)) {
    const possibleStringValues = inferIdentifierStringValues(node, context.sourceFile);
    return {
      ...base,
      expressionKind: "identifier",
      name: node.text,
      ...(possibleStringValues.length > 0 ? { possibleStringValues } : {}),
    };
  }

  if (ts.isTemplateExpression(node)) {
    return {
      ...base,
      expressionKind: "template-literal",
      headText: node.head.text,
      spans: node.templateSpans.map(
        (span): SourceTemplateExpressionSpan => ({
          expressionId: collectExpression(span.expression, expressionsById, context),
          literalText: span.literal.text,
          location: toSourceAnchor(span, context.sourceFile, context.filePath),
        }),
      ),
    };
  }

  if (ts.isPropertyAccessExpression(node)) {
    return {
      ...base,
      expressionKind: "member-access",
      objectExpressionId: collectExpression(node.expression, expressionsById, context),
      propertyName: node.name.text,
      optional: Boolean(node.questionDotToken),
    };
  }

  if (ts.isElementAccessExpression(node)) {
    return {
      ...base,
      expressionKind: "element-access",
      objectExpressionId: collectExpression(node.expression, expressionsById, context),
      ...(node.argumentExpression
        ? {
            argumentExpressionId: collectExpression(
              node.argumentExpression,
              expressionsById,
              context,
            ),
          }
        : {}),
      optional: Boolean(node.questionDotToken),
    };
  }

  if (ts.isCallExpression(node)) {
    const argumentExpressionIds: string[] = [];
    let hasSpreadArgument = false;
    for (const argument of node.arguments) {
      if (ts.isSpreadElement(argument)) {
        hasSpreadArgument = true;
        argumentExpressionIds.push(
          collectExpression(argument.expression, expressionsById, context),
        );
        continue;
      }

      argumentExpressionIds.push(collectExpression(argument, expressionsById, context));
    }

    return {
      ...base,
      expressionKind: "call",
      calleeExpressionId: collectExpression(node.expression, expressionsById, context),
      argumentExpressionIds,
      hasSpreadArgument,
      optional: Boolean(node.questionDotToken),
    };
  }

  if (ts.isArrayLiteralExpression(node)) {
    const elementExpressionIds: string[] = [];
    let hasSpreadElement = false;
    let hasOmittedElement = false;
    for (const element of node.elements) {
      if (ts.isOmittedExpression(element)) {
        hasOmittedElement = true;
        continue;
      }

      if (ts.isSpreadElement(element)) {
        hasSpreadElement = true;
        elementExpressionIds.push(collectExpression(element.expression, expressionsById, context));
        continue;
      }

      elementExpressionIds.push(collectExpression(element, expressionsById, context));
    }

    return {
      ...base,
      expressionKind: "array-literal",
      elementExpressionIds,
      hasSpreadElement,
      hasOmittedElement,
    };
  }

  if (ts.isObjectLiteralExpression(node)) {
    const properties = node.properties.map((property) =>
      collectObjectExpressionProperty(property, expressionsById, context),
    );

    return {
      ...base,
      expressionKind: "object-literal",
      properties,
      hasSpreadProperty: properties.some((property) => property.propertyKind === "spread"),
      hasUnsupportedProperty: properties.some(
        (property) => property.propertyKind === "unsupported",
      ),
    };
  }

  if (ts.isConditionalExpression(node)) {
    return {
      ...base,
      expressionKind: "conditional",
      conditionExpressionId: collectExpression(node.condition, expressionsById, context),
      whenTrueExpressionId: collectExpression(node.whenTrue, expressionsById, context),
      whenFalseExpressionId: collectExpression(node.whenFalse, expressionsById, context),
    };
  }

  if (ts.isBinaryExpression(node)) {
    const operator = getSupportedBinaryOperator(node.operatorToken.kind);
    if (operator) {
      return {
        ...base,
        expressionKind: "binary",
        operator,
        leftExpressionId: collectExpression(node.left, expressionsById, context),
        rightExpressionId: collectExpression(node.right, expressionsById, context),
      };
    }
  }

  if (ts.isPrefixUnaryExpression(node)) {
    const operator = getSupportedPrefixUnaryOperator(node.operator);
    if (operator) {
      return {
        ...base,
        expressionKind: "prefix-unary",
        operator,
        operandExpressionId: collectExpression(node.operand, expressionsById, context),
      };
    }
  }

  if (ts.isParenthesizedExpression(node)) {
    return buildWrapperExpressionSyntax(
      "parenthesized",
      node.expression,
      base,
      expressionsById,
      context,
    );
  }

  if (ts.isAsExpression(node)) {
    return buildWrapperExpressionSyntax("as", node.expression, base, expressionsById, context);
  }

  if (ts.isSatisfiesExpression(node)) {
    return buildWrapperExpressionSyntax(
      "satisfies",
      node.expression,
      base,
      expressionsById,
      context,
    );
  }

  if (ts.isTypeAssertionExpression(node)) {
    return buildWrapperExpressionSyntax(
      "type-assertion",
      node.expression,
      base,
      expressionsById,
      context,
    );
  }

  if (ts.isNonNullExpression(node)) {
    return buildWrapperExpressionSyntax(
      "non-null",
      node.expression,
      base,
      expressionsById,
      context,
    );
  }

  return {
    ...base,
    expressionKind: "unsupported",
    syntaxKind: ts.SyntaxKind[node.kind],
  };
}

function collectObjectExpressionProperty(
  property: ts.ObjectLiteralElementLike,
  expressionsById: Map<string, SourceExpressionSyntaxFact>,
  context: {
    filePath: string;
    sourceFile: ts.SourceFile;
  },
): SourceObjectExpressionProperty {
  const location = toSourceAnchor(property, context.sourceFile, context.filePath);

  if (ts.isSpreadAssignment(property)) {
    return {
      propertyKind: "spread",
      location,
      spreadExpressionId: collectExpression(property.expression, expressionsById, context),
    };
  }

  if (ts.isShorthandPropertyAssignment(property)) {
    return {
      propertyKind: "shorthand",
      location,
      keyKind: "identifier",
      keyText: property.name.text,
      ...(property.objectAssignmentInitializer
        ? {
            valueExpressionId: collectExpression(
              property.objectAssignmentInitializer,
              expressionsById,
              context,
            ),
          }
        : {}),
    };
  }

  if (ts.isPropertyAssignment(property)) {
    return {
      propertyKind: "property",
      location,
      ...collectPropertyName(property.name, expressionsById, context),
      valueExpressionId: collectExpression(property.initializer, expressionsById, context),
    };
  }

  if (ts.isMethodDeclaration(property)) {
    return {
      propertyKind: "method",
      location,
      ...collectPropertyName(property.name, expressionsById, context),
    };
  }

  if (ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
    return {
      propertyKind: "accessor",
      location,
      ...collectPropertyName(property.name, expressionsById, context),
    };
  }

  return {
    propertyKind: "unsupported",
    location,
  };
}

function collectPropertyName(
  name: ts.PropertyName,
  expressionsById: Map<string, SourceExpressionSyntaxFact>,
  context: {
    filePath: string;
    sourceFile: ts.SourceFile;
  },
): Pick<SourceObjectExpressionProperty, "keyKind" | "keyText" | "keyExpressionId"> {
  if (ts.isIdentifier(name)) {
    return {
      keyKind: "identifier",
      keyText: name.text,
    };
  }

  if (ts.isStringLiteral(name)) {
    return {
      keyKind: "string",
      keyText: name.text,
    };
  }

  if (ts.isNumericLiteral(name)) {
    return {
      keyKind: "numeric",
      keyText: name.text,
    };
  }

  if (ts.isComputedPropertyName(name)) {
    return {
      keyKind: "computed",
      keyExpressionId: collectExpression(name.expression, expressionsById, context),
    };
  }

  return {
    keyKind: "unknown",
  };
}

function buildWrapperExpressionSyntax(
  wrapperKind: SourceWrapperExpressionSyntax["wrapperKind"],
  expression: ts.Expression,
  base: Pick<SourceExpressionSyntaxFact, "expressionId" | "filePath" | "location" | "rawText">,
  expressionsById: Map<string, SourceExpressionSyntaxFact>,
  context: {
    filePath: string;
    sourceFile: ts.SourceFile;
  },
): SourceExpressionSyntaxFact {
  return {
    ...base,
    expressionKind: "wrapper",
    wrapperKind,
    innerExpressionId: collectExpression(expression, expressionsById, context),
  };
}

function getSupportedBinaryOperator(
  kind: ts.SyntaxKind,
): SourceBinaryExpressionSyntax["operator"] | undefined {
  if (kind === ts.SyntaxKind.PlusToken) {
    return "+";
  }

  if (kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return "&&";
  }

  if (kind === ts.SyntaxKind.BarBarToken) {
    return "||";
  }

  if (kind === ts.SyntaxKind.QuestionQuestionToken) {
    return "??";
  }

  return undefined;
}

function getSupportedPrefixUnaryOperator(
  operator: ts.PrefixUnaryOperator,
): SourcePrefixUnaryExpressionSyntax["operator"] | undefined {
  if (operator === ts.SyntaxKind.ExclamationToken) {
    return "!";
  }

  if (operator === ts.SyntaxKind.PlusToken) {
    return "+";
  }

  if (operator === ts.SyntaxKind.MinusToken) {
    return "-";
  }

  if (operator === ts.SyntaxKind.TildeToken) {
    return "~";
  }

  return undefined;
}

function inferIdentifierStringValues(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): string[] {
  const values = new Set<string>();
  let current: ts.Node | undefined = identifier.parent;
  while (current) {
    if (ts.isFunctionLike(current)) {
      for (const parameter of current.parameters) {
        for (const value of inferParameterIdentifierStringValues({
          identifierName: identifier.text,
          parameter,
          sourceFile,
        })) {
          values.add(value);
        }
      }
      break;
    }
    current = current.parent;
  }

  return [...values].sort((left, right) => left.localeCompare(right));
}

function inferParameterIdentifierStringValues(input: {
  identifierName: string;
  parameter: ts.ParameterDeclaration;
  sourceFile: ts.SourceFile;
}): string[] {
  if (ts.isIdentifier(input.parameter.name) && input.parameter.name.text === input.identifierName) {
    return resolveStringLiteralTypeValues(input.parameter.type, input.sourceFile);
  }

  if (!ts.isObjectBindingPattern(input.parameter.name) || !input.parameter.type) {
    return [];
  }

  const bindingElement = input.parameter.name.elements.find(
    (element) => ts.isIdentifier(element.name) && element.name.text === input.identifierName,
  );
  if (!bindingElement) {
    return [];
  }

  const propertyName = getBindingElementPropertyName(bindingElement);
  if (!propertyName) {
    return [];
  }

  return resolveStringLiteralTypeValues(
    findPropertyTypeNode(input.parameter.type, propertyName, input.sourceFile),
    input.sourceFile,
  );
}

function getBindingElementPropertyName(element: ts.BindingElement): string | undefined {
  if (!element.propertyName) {
    return ts.isIdentifier(element.name) ? element.name.text : undefined;
  }

  if (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)) {
    return element.propertyName.text;
  }

  return undefined;
}

function findPropertyTypeNode(
  typeNode: ts.TypeNode | undefined,
  propertyName: string,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  const resolvedTypeNode = typeNode
    ? (resolveTypeReference(typeNode, sourceFile) ?? typeNode)
    : undefined;
  if (!resolvedTypeNode || !ts.isTypeLiteralNode(resolvedTypeNode)) {
    return undefined;
  }

  for (const member of resolvedTypeNode.members) {
    if (!ts.isPropertySignature(member) || !member.type) {
      continue;
    }

    if (getPropertyNameText(member.name) === propertyName) {
      return member.type;
    }
  }

  return undefined;
}

function resolveStringLiteralTypeValues(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
): string[] {
  if (!typeNode) {
    return [];
  }

  const resolvedTypeNode = resolveTypeReference(typeNode, sourceFile) ?? typeNode;
  if (ts.isUnionTypeNode(resolvedTypeNode)) {
    return [
      ...new Set(
        resolvedTypeNode.types.flatMap((member) =>
          resolveStringLiteralTypeValues(member, sourceFile),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }

  if (
    ts.isLiteralTypeNode(resolvedTypeNode) &&
    (ts.isStringLiteral(resolvedTypeNode.literal) ||
      ts.isNoSubstitutionTemplateLiteral(resolvedTypeNode.literal))
  ) {
    return [resolvedTypeNode.literal.text];
  }

  return [];
}

function resolveTypeReference(
  typeNode: ts.TypeNode,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) {
    return undefined;
  }

  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeNode.typeName.text) {
      return statement.type;
    }
  }

  return undefined;
}

function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}
