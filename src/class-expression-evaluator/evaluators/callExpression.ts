import ts from "typescript";
import type { EvaluationEnvironment, EvaluationHelpers, LocalFunctionBinding } from "../types.js";

export function evaluateCallExpression(
  expression: ts.CallExpression,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
  depth: number,
) {
  const transparentArrayResult = evaluateTransparentArrayCall(expression, helpers, env, depth + 1);
  if (transparentArrayResult) {
    return transparentArrayResult;
  }

  if (ts.isIdentifier(expression.expression)) {
    const localFunction = helpers.context.localFunctions.get(expression.expression.text);
    if (localFunction) {
      return evaluateLocalFunctionCall(expression, localFunction, helpers, env, depth + 1);
    }

    if (helpers.context.helperImports.has(expression.expression.text)) {
      return evaluateImportedHelperCall(expression, helpers, env, depth + 1);
    }
  }

  return helpers.dynamicOnly(expression, "helper-call", "low");
}

function evaluateTransparentArrayCall(
  expression: ts.CallExpression,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
  depth: number,
) {
  if (!ts.isPropertyAccessExpression(expression.expression)) {
    return undefined;
  }

  if (
    expression.expression.name.text === "join" &&
    (expression.arguments.length === 0 ||
      (expression.arguments.length === 1 &&
        ts.isStringLiteral(expression.arguments[0]) &&
        expression.arguments[0].text === " "))
  ) {
    return helpers.evaluateArrayLikeExpression(expression.expression.expression, env, depth + 1);
  }

  if (
    expression.expression.name.text === "filter" &&
    expression.arguments.length === 1 &&
    ts.isIdentifier(expression.arguments[0]) &&
    expression.arguments[0].text === "Boolean"
  ) {
    return helpers.evaluateArrayLikeExpression(expression.expression.expression, env, depth + 1);
  }

  return undefined;
}

function evaluateImportedHelperCall(
  expression: ts.CallExpression,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
  depth: number,
) {
  const result = helpers.emptyEvaluation();

  for (const argument of expression.arguments) {
    if (ts.isObjectLiteralExpression(argument)) {
      helpers.mergeInto(result, evaluateHelperObject(argument, helpers, env));
      continue;
    }

    helpers.mergeInto(result, helpers.evaluateExpression(argument, env, depth + 1));
  }

  return helpers.markAllTokensAsExpressionEvaluated(result);
}

function evaluateHelperObject(
  expression: ts.ObjectLiteralExpression,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
) {
  const result = helpers.emptyEvaluation();

  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      helpers.mergeInto(result, helpers.dynamicOnly(property, "helper-call", "low"));
      continue;
    }

    const propertyName = helpers.getStaticPropertyName(property.name);
    if (!propertyName) {
      helpers.mergeInto(result, helpers.dynamicOnly(property, "helper-call", "low"));
      continue;
    }

    const condition = helpers.resolveBooleanValue(property.initializer, env, new Set());
    const certainty = condition === true ? "definite" : "possible";
    helpers.mergeInto(
      result,
      helpers.tokenResult(
        propertyName,
        certainty,
        property.name,
        "expression-evaluated",
        condition === true ? "high" : "medium",
        property.getText(helpers.context.parsedSourceFile),
      ),
    );
  }

  return result;
}

function evaluateLocalFunctionCall(
  expression: ts.CallExpression,
  localFunction: LocalFunctionBinding,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
  depth: number,
) {
  const transparentJoinParameter = getTransparentJoinParameter(localFunction);
  if (transparentJoinParameter) {
    const parameterIndex = localFunction.parameters.findIndex(
      (parameter) =>
        ts.isIdentifier(parameter.name) && parameter.name.text === transparentJoinParameter.name,
    );
    if (parameterIndex >= 0) {
      if (transparentJoinParameter.rest) {
        return helpers.markAllTokensAsExpressionEvaluated(
          helpers.evaluateArrayElements(expression.arguments.slice(parameterIndex), env, depth + 1),
        );
      }

      const argument =
        expression.arguments[parameterIndex] ??
        localFunction.parameters[parameterIndex]?.initializer;
      if (argument) {
        return helpers.markAllTokensAsExpressionEvaluated(
          helpers.evaluateArrayLikeExpression(argument, env, depth + 1),
        );
      }
    }
  }

  const nextEnv = new Map(env);

  for (let index = 0; index < localFunction.parameters.length; index += 1) {
    const parameter = localFunction.parameters[index];
    if (!ts.isIdentifier(parameter.name)) {
      return helpers.dynamicOnly(expression, "helper-call", "low");
    }

    if (parameter.dotDotDotToken) {
      nextEnv.set(
        parameter.name.text,
        ts.factory.createArrayLiteralExpression(expression.arguments.slice(index)),
      );
      continue;
    }

    const argument = expression.arguments[index] ?? parameter.initializer;
    if (!argument) {
      return helpers.dynamicOnly(expression, "helper-call", "low");
    }

    nextEnv.set(parameter.name.text, argument);
  }

  return helpers.markAllTokensAsExpressionEvaluated(
    helpers.evaluateExpression(localFunction.bodyExpression, nextEnv, depth + 1),
  );
}

function getTransparentJoinParameter(localFunction: LocalFunctionBinding) {
  const { bodyExpression } = localFunction;
  if (
    !ts.isCallExpression(bodyExpression) ||
    !ts.isPropertyAccessExpression(bodyExpression.expression)
  ) {
    return undefined;
  }

  if (bodyExpression.expression.name.text !== "join") {
    return undefined;
  }

  if (
    bodyExpression.arguments.length > 1 ||
    (bodyExpression.arguments.length === 1 &&
      (!ts.isStringLiteral(bodyExpression.arguments[0]) ||
        bodyExpression.arguments[0].text !== " "))
  ) {
    return undefined;
  }

  const baseExpression = unwrapFilterBoolean(bodyExpression.expression.expression);
  if (!baseExpression || !ts.isIdentifier(baseExpression)) {
    return undefined;
  }

  const parameter = localFunction.parameters.find(
    (entry) => ts.isIdentifier(entry.name) && entry.name.text === baseExpression.text,
  );
  if (!parameter || !ts.isIdentifier(parameter.name)) {
    return undefined;
  }

  return {
    name: parameter.name.text,
    rest: Boolean(parameter.dotDotDotToken),
  };
}

function unwrapFilterBoolean(expression: ts.Expression): ts.Expression | undefined {
  if (ts.isIdentifier(expression)) {
    return expression;
  }

  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "filter" &&
    expression.arguments.length === 1 &&
    ts.isIdentifier(expression.arguments[0]) &&
    expression.arguments[0].text === "Boolean"
  ) {
    return expression.expression.expression;
  }

  return undefined;
}
