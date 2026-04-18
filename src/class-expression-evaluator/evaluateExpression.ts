import ts from "typescript";
import { evaluateArrayElements } from "./evaluators/arrayExpression.js";
import { evaluateBinaryExpression } from "./evaluators/binaryExpression.js";
import { evaluateCallExpression } from "./evaluators/callExpression.js";
import { evaluateTemplateExpression } from "./evaluators/templateExpression.js";
import {
  emptyEvaluation,
  downgradeTokensToPossible,
  dynamicOnly,
  markAllTokensAsExpressionEvaluated,
  mergeBranchResults,
  mergeInto,
  tokenResult,
  tokensFromString,
} from "./resultUtils.js";
import {
  getStaticPropertyName,
  resolveBooleanValue,
  resolveIdentifierExpression,
  resolveStaticClassValue,
} from "./resolution.js";
import type {
  ClassExpressionEvaluation,
  ClassExpressionEvaluationContext,
  EvaluationEnvironment,
  EvaluationHelpers,
} from "./types.js";

const MAX_EVALUATION_DEPTH = 8;

export function createExpressionEvaluator(context: ClassExpressionEvaluationContext) {
  const helpers: EvaluationHelpers = {
    context,
    evaluateExpression,
    evaluateArrayElements: (elements, env, depth) =>
      evaluateArrayElements(elements, helpers, env, depth),
    evaluateArrayLikeExpression,
    mergeInto,
    mergeBranchResults,
    markAllTokensAsExpressionEvaluated,
    downgradeTokensToPossible,
    tokensFromString,
    tokenResult,
    dynamicOnly,
    emptyEvaluation,
    resolveBooleanValue: (expression, env, seenIdentifiers) =>
      resolveBooleanValue(expression, context, env, seenIdentifiers),
    resolveIdentifierExpression: (expression, env) => resolveIdentifierExpression(expression, context, env),
    getStaticPropertyName,
  };

  function evaluateExpression(
    expression: ts.Expression,
    env: EvaluationEnvironment,
    depth: number,
  ): ClassExpressionEvaluation {
    if (depth > MAX_EVALUATION_DEPTH) {
      return dynamicOnly(expression, "helper-call", "low");
    }

    const staticValue = resolveStaticClassValue(expression, context, env, new Set());
    if (staticValue) {
      return tokensFromString(staticValue.value, expression, staticValue.kind, staticValue.confidence);
    }

    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return tokensFromString(expression.text, expression, "string-literal", "high");
    }

    if (ts.isParenthesizedExpression(expression)) {
      return evaluateExpression(expression.expression, env, depth + 1);
    }

    if (ts.isIdentifier(expression)) {
      const resolved = resolveIdentifierExpression(expression, context, env);
      if (!resolved) {
        return emptyEvaluation();
      }

      return evaluateExpression(resolved, env, depth + 1);
    }

    if (ts.isTemplateExpression(expression)) {
      return evaluateTemplateExpression(expression, helpers, env, depth + 1);
    }

    if (ts.isConditionalExpression(expression)) {
      return mergeBranchResults(
        evaluateExpression(expression.whenTrue, env, depth + 1),
        evaluateExpression(expression.whenFalse, env, depth + 1),
      );
    }

    if (ts.isArrayLiteralExpression(expression)) {
      return evaluateArrayElements(expression.elements, helpers, env, depth + 1);
    }

    if (ts.isBinaryExpression(expression)) {
      return evaluateBinaryExpression(expression, helpers, env, depth + 1);
    }

    if (ts.isCallExpression(expression)) {
      return evaluateCallExpression(expression, helpers, env, depth + 1);
    }

    return emptyEvaluation();
  }

  function evaluateArrayLikeExpression(
    expression: ts.Expression,
    env: EvaluationEnvironment,
    depth: number,
  ): ClassExpressionEvaluation {
    if (ts.isParenthesizedExpression(expression)) {
      return evaluateArrayLikeExpression(expression.expression, env, depth + 1);
    }

    if (ts.isArrayLiteralExpression(expression)) {
      return evaluateArrayElements(expression.elements, helpers, env, depth + 1);
    }

    if (ts.isIdentifier(expression)) {
      const resolved = resolveIdentifierExpression(expression, context, env);
      if (!resolved) {
        return dynamicOnly(expression, "helper-call", "low");
      }

      return evaluateArrayLikeExpression(resolved, env, depth + 1);
    }

    if (ts.isCallExpression(expression)) {
      const transparentCall = evaluateCallExpression(expression, helpers, env, depth + 1);
      if (transparentCall.tokens.length > 0 || transparentCall.dynamics.length > 0) {
        return transparentCall;
      }
    }

    return evaluateExpression(expression, env, depth + 1);
  }

  return {
    evaluateExpression,
  };
}
