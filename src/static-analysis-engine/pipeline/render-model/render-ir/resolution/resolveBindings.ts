import ts from "typescript";

import type { LocalHelperDefinition } from "../collection/shared/types.js";
import type { BuildContext } from "../shared/internalTypes.js";
import { MAX_LOCAL_HELPER_EXPANSION_DEPTH } from "../../../../libraries/policy/index.js";
import {
  buildHelperExpansionReason,
  getExpansionScope,
  type HelperExpansionReason,
} from "../shared/expansionSemantics.js";

export function resolveBoundExpression(
  expression: ts.Expression,
  context: BuildContext,
): ts.Expression | undefined {
  if (ts.isIdentifier(expression)) {
    return context.expressionBindings.get(expression.text);
  }

  if (ts.isCallExpression(expression)) {
    return resolveHelperCallExpression(expression, context);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const propsObjectProperty = resolvePropsObjectPropertyAccess(expression, context);
    if (propsObjectProperty) {
      return propsObjectProperty;
    }

    const namespaceProperty = resolveNamespacePropertyAccess(expression, context);
    if (namespaceProperty) {
      return namespaceProperty;
    }

    return resolveObjectLikePropertyExpression(
      expression.expression,
      expression.name.text,
      context,
    );
  }

  if (ts.isElementAccessExpression(expression)) {
    const propertyName = resolveElementAccessPropertyName(expression.argumentExpression, context);
    if (propertyName === undefined) {
      return undefined;
    }

    return resolveObjectLikePropertyExpression(expression.expression, propertyName, context);
  }

  return undefined;
}

function resolvePropsObjectPropertyAccess(
  expression: ts.PropertyAccessExpression,
  context: BuildContext,
): ts.Expression | undefined {
  if (
    context.propsObjectBindingName &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === context.propsObjectBindingName
  ) {
    return context.propsObjectProperties.get(expression.name.text);
  }

  return undefined;
}

function resolveNamespacePropertyAccess(
  expression: ts.PropertyAccessExpression,
  context: BuildContext,
): ts.Expression | undefined {
  if (ts.isIdentifier(expression.expression)) {
    return context.namespaceExpressionBindings
      .get(expression.expression.text)
      ?.get(expression.name.text);
  }

  return undefined;
}

export function resolveHelperCallExpression(
  expression: ts.CallExpression,
  context: BuildContext,
): ts.Expression | undefined {
  return resolveHelperCallContext(expression, context)?.expression;
}

export function getHelperCallResolutionFailureReason(
  expression: ts.CallExpression,
  context: BuildContext,
): HelperExpansionReason | undefined {
  const helperLookup = resolveHelperDefinitionForCall(expression, context);
  if (!helperLookup) {
    return undefined;
  }

  const { helperName, helperDefinition } = helperLookup;
  if (!helperDefinition) {
    return undefined;
  }
  const expansionScope = getExpansionScope(
    context.currentComponentFilePath,
    helperDefinition.filePath,
  );

  if (context.helperExpansionStack.includes(helperName)) {
    return buildHelperExpansionReason(expansionScope, "cycle");
  }

  if (context.helperExpansionStack.length >= MAX_LOCAL_HELPER_EXPANSION_DEPTH) {
    return buildHelperExpansionReason(expansionScope, "budgetExceeded");
  }

  if (
    expression.arguments.length !== helperDefinition.parameterNames.length ||
    expression.arguments.some((argument) => ts.isSpreadElement(argument))
  ) {
    return buildHelperExpansionReason(expansionScope, "unsupportedArguments");
  }

  return undefined;
}

export function resolveHelperCallContext(
  expression: ts.CallExpression,
  context: BuildContext,
):
  | {
      expression: ts.Expression;
      context: BuildContext;
    }
  | undefined {
  const helperLookup = resolveHelperDefinitionForCall(expression, context);
  if (!helperLookup) {
    return undefined;
  }

  const { helperName, helperDefinition } = helperLookup;
  if (!helperDefinition) {
    return undefined;
  }

  if (context.helperExpansionStack.includes(helperName)) {
    return undefined;
  }

  if (context.helperExpansionStack.length >= MAX_LOCAL_HELPER_EXPANSION_DEPTH) {
    return undefined;
  }

  if (
    expression.arguments.length !== helperDefinition.parameterNames.length ||
    expression.arguments.some((argument) => ts.isSpreadElement(argument))
  ) {
    return undefined;
  }

  const helperExpressionBindings = new Map<string, ts.Expression>();
  for (let index = 0; index < helperDefinition.parameterNames.length; index += 1) {
    helperExpressionBindings.set(
      helperDefinition.parameterNames[index],
      expression.arguments[index],
    );
  }

  const inheritedExpressionBindings = mergeExpressionBindings(
    context.expressionBindings,
    helperExpressionBindings,
  );
  const helperContext: BuildContext = {
    ...context,
    filePath: helperDefinition.filePath,
    parsedSourceFile: helperDefinition.parsedSourceFile,
    currentComponentFilePath: helperDefinition.filePath,
    expressionBindings: mergeExpressionBindings(
      inheritedExpressionBindings,
      helperDefinition.localExpressionBindings,
    ),
    namespaceExpressionBindings: context.namespaceExpressionBindings,
    namespaceHelperDefinitions: context.namespaceHelperDefinitions,
    namespaceComponentDefinitions: context.namespaceComponentDefinitions,
    helperExpansionStack: [...context.helperExpansionStack, helperName],
  };

  return {
    expression: helperDefinition.returnExpression,
    context: helperContext,
  };
}

export function mergeExpressionBindings(
  baseBindings: Map<string, ts.Expression>,
  localBindings: Map<string, ts.Expression>,
): Map<string, ts.Expression> {
  const merged = new Map(baseBindings);
  for (const [identifierName, expression] of localBindings.entries()) {
    merged.set(identifierName, expression);
  }

  return merged;
}

function resolveHelperDefinitionForCall(
  expression: ts.CallExpression,
  context: BuildContext,
):
  | {
      helperName: string;
      helperDefinition: LocalHelperDefinition;
    }
  | undefined {
  if (ts.isIdentifier(expression.expression)) {
    const helperDefinition = context.helperDefinitions.get(expression.expression.text);
    return helperDefinition
      ? {
          helperName: expression.expression.text,
          helperDefinition,
        }
      : undefined;
  }

  if (
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression)
  ) {
    const namespaceName = expression.expression.expression.text;
    const helperName = `${namespaceName}.${expression.expression.name.text}`;
    const helperDefinition = context.namespaceHelperDefinitions
      .get(namespaceName)
      ?.get(expression.expression.name.text);
    return helperDefinition ? { helperName, helperDefinition } : undefined;
  }

  return undefined;
}

export function mergeHelperDefinitions(
  baseDefinitions: Map<string, LocalHelperDefinition>,
  localDefinitions: Map<string, LocalHelperDefinition>,
): Map<string, LocalHelperDefinition> {
  const merged = new Map(baseDefinitions);
  for (const [helperName, definition] of localDefinitions.entries()) {
    merged.set(helperName, definition);
  }

  return merged;
}

function resolveObjectLikePropertyExpression(
  baseExpression: ts.Expression,
  propertyName: string,
  context: BuildContext,
): ts.Expression | undefined {
  const resolvedBaseExpression = resolveBoundExpression(baseExpression, context);
  if (!resolvedBaseExpression) {
    return undefined;
  }

  return resolvePropertyValueFromExpression(resolvedBaseExpression, propertyName, context);
}

function resolvePropertyValueFromExpression(
  expression: ts.Expression,
  propertyName: string,
  context: BuildContext,
): ts.Expression | undefined {
  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return resolvePropertyValueFromExpression(
      helperResolution.expression,
      propertyName,
      helperResolution.context,
    );
  }

  const unwrappedExpression = unwrapResolvableExpression(expression);
  if (ts.isObjectLiteralExpression(unwrappedExpression)) {
    for (const property of unwrappedExpression.properties) {
      if (ts.isSpreadAssignment(property)) {
        return undefined;
      }

      if (ts.isPropertyAssignment(property)) {
        const candidateName = getObjectLiteralPropertyName(property.name);
        if (candidateName === propertyName) {
          return property.initializer;
        }

        continue;
      }

      if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
        return property.name;
      }

      return undefined;
    }
  }

  return undefined;
}

function resolveElementAccessPropertyName(
  argumentExpression: ts.Expression | undefined,
  context: BuildContext,
): string | undefined {
  if (!argumentExpression) {
    return undefined;
  }

  const helperResolution = ts.isCallExpression(argumentExpression)
    ? resolveHelperCallContext(argumentExpression, context)
    : undefined;
  if (helperResolution) {
    return resolveElementAccessPropertyName(helperResolution.expression, helperResolution.context);
  }

  const boundExpression = resolveBoundExpression(argumentExpression, context);
  if (boundExpression) {
    return resolveElementAccessPropertyName(boundExpression, context);
  }

  const unwrappedExpression = unwrapResolvableExpression(argumentExpression);
  if (
    ts.isStringLiteral(unwrappedExpression) ||
    ts.isNoSubstitutionTemplateLiteral(unwrappedExpression) ||
    ts.isNumericLiteral(unwrappedExpression)
  ) {
    return unwrappedExpression.text;
  }

  return undefined;
}

function getObjectLiteralPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function unwrapResolvableExpression(expression: ts.Expression): ts.Expression {
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
