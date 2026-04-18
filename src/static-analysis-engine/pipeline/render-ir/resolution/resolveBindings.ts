import ts from "typescript";

import type { LocalHelperDefinition } from "../collection/types.js";
import type { BuildContext } from "../shared/internalTypes.js";
import {
  LOCAL_HELPER_EXPANSION_REASONS,
  MAX_LOCAL_HELPER_EXPANSION_DEPTH,
  type SameFileHelperExpansionReason,
} from "../shared/expansionPolicy.js";

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

  if (
    ts.isPropertyAccessExpression(expression) &&
    context.propsObjectBindingName &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === context.propsObjectBindingName
  ) {
    return context.propsObjectProperties.get(expression.name.text);
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
): SameFileHelperExpansionReason | undefined {
  if (!ts.isIdentifier(expression.expression)) {
    return undefined;
  }

  const helperName = expression.expression.text;
  const helperDefinition = context.helperDefinitions.get(helperName);
  if (!helperDefinition) {
    return undefined;
  }

  if (context.helperExpansionStack.includes(helperName)) {
    return LOCAL_HELPER_EXPANSION_REASONS.cycle;
  }

  if (context.helperExpansionStack.length >= MAX_LOCAL_HELPER_EXPANSION_DEPTH) {
    return LOCAL_HELPER_EXPANSION_REASONS.budgetExceeded;
  }

  if (
    expression.arguments.length !== helperDefinition.parameterNames.length ||
    expression.arguments.some((argument) => ts.isSpreadElement(argument))
  ) {
    return LOCAL_HELPER_EXPANSION_REASONS.unsupportedArguments;
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
  if (!ts.isIdentifier(expression.expression)) {
    return undefined;
  }

  const helperName = expression.expression.text;
  const helperDefinition = context.helperDefinitions.get(helperName);
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
    expressionBindings: mergeExpressionBindings(
      inheritedExpressionBindings,
      helperDefinition.localExpressionBindings,
    ),
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
