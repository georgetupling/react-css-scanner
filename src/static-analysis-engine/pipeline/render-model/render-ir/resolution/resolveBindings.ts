import ts from "typescript";

import type { LocalHelperDefinition } from "../collection/shared/types.js";
import type { BuildContext } from "../shared/internalTypes.js";
import { MAX_LOCAL_HELPER_EXPANSION_DEPTH } from "../../../../libraries/policy/index.js";
import {
  buildHelperExpansionReason,
  getExpansionScope,
  type HelperExpansionReason,
} from "../shared/expansionSemantics.js";

const MAX_PROPERTY_NAME_RESOLUTION_DEPTH = 100;

type PropertyNameResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

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

  if (!canBindHelperArguments(expression, helperDefinition, context)) {
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

  if (!canBindHelperArguments(expression, helperDefinition, context)) {
    return undefined;
  }

  const helperExpressionBindings = bindHelperArguments(expression, helperDefinition, context);

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

function canBindHelperArguments(
  expression: ts.CallExpression,
  helperDefinition: LocalHelperDefinition,
  context: BuildContext,
): boolean {
  const expandedArguments = expandHelperArguments(expression.arguments, context);
  if (!expandedArguments) {
    return false;
  }

  if (helperDefinition.restParameterName) {
    return expandedArguments.length >= helperDefinition.parameterNames.length;
  }

  return expandedArguments.length === helperDefinition.parameterNames.length;
}

function bindHelperArguments(
  expression: ts.CallExpression,
  helperDefinition: LocalHelperDefinition,
  context: BuildContext,
): Map<string, ts.Expression> {
  const helperExpressionBindings = new Map<string, ts.Expression>();
  const expandedArguments = expandHelperArguments(expression.arguments, context) ?? [];
  for (let index = 0; index < helperDefinition.parameterNames.length; index += 1) {
    helperExpressionBindings.set(helperDefinition.parameterNames[index], expandedArguments[index]);
  }

  if (helperDefinition.restParameterName) {
    const restArguments = expandedArguments.slice(helperDefinition.parameterNames.length);
    helperExpressionBindings.set(
      helperDefinition.restParameterName,
      ts.factory.createArrayLiteralExpression(restArguments, false),
    );
  }

  return helperExpressionBindings;
}

function expandHelperArguments(
  argumentsList: ts.NodeArray<ts.Expression>,
  context: BuildContext,
): ts.Expression[] | undefined {
  const expandedArguments: ts.Expression[] = [];
  for (const argument of argumentsList) {
    if (!ts.isSpreadElement(argument)) {
      expandedArguments.push(argument);
      continue;
    }

    const spreadExpression =
      resolveBoundExpression(argument.expression, context) ?? argument.expression;
    if (!ts.isArrayLiteralExpression(spreadExpression)) {
      return undefined;
    }

    for (const element of spreadExpression.elements) {
      if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
        return undefined;
      }

      expandedArguments.push(element);
    }
  }

  return expandedArguments;
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
  state: PropertyNameResolutionState = {
    activeExpressions: new Set(),
    depth: 0,
  },
): string | undefined {
  if (!argumentExpression) {
    return undefined;
  }

  if (state.depth > MAX_PROPERTY_NAME_RESOLUTION_DEPTH) {
    return undefined;
  }

  const expressionKey = getExpressionResolutionKey(argumentExpression, context);
  if (state.activeExpressions.has(expressionKey)) {
    return undefined;
  }

  state.activeExpressions.add(expressionKey);
  try {
    const helperResolution = ts.isCallExpression(argumentExpression)
      ? resolveHelperCallContext(argumentExpression, context)
      : undefined;
    if (helperResolution) {
      return resolveElementAccessPropertyName(
        helperResolution.expression,
        helperResolution.context,
        nextPropertyNameResolutionState(state),
      );
    }

    const boundExpression = resolveBoundExpression(argumentExpression, context);
    if (boundExpression) {
      return resolveElementAccessPropertyName(
        boundExpression,
        context,
        nextPropertyNameResolutionState(state),
      );
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
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
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

function nextPropertyNameResolutionState(
  state: PropertyNameResolutionState,
): PropertyNameResolutionState {
  return {
    activeExpressions: state.activeExpressions,
    depth: state.depth + 1,
  };
}

function getExpressionResolutionKey(expression: ts.Expression, context: BuildContext): string {
  return `${context.filePath}:${expression.pos}:${expression.end}:${expression.kind}`;
}
