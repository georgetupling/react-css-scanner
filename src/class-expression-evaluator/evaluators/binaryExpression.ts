import ts from "typescript";
import type { EvaluationEnvironment, EvaluationHelpers } from "../types.js";

export function evaluateBinaryExpression(
  expression: ts.BinaryExpression,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
  depth: number,
) {
  if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return helpers.dynamicOnly(expression, "template-literal", "medium");
  }

  if (
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    const resolvedBoolean = helpers.resolveBooleanValue(expression.left, env, new Set());
    if (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      resolvedBoolean === true
    ) {
      return helpers.evaluateExpression(expression.right, env, depth + 1);
    }

    if (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      resolvedBoolean === false
    ) {
      return helpers.emptyEvaluation();
    }

    if (
      (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
      resolvedBoolean === false
    ) {
      return helpers.evaluateExpression(expression.right, env, depth + 1);
    }

    if (
      (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
      resolvedBoolean === true
    ) {
      return helpers.evaluateExpression(expression.left, env, depth + 1);
    }

    return helpers.downgradeTokensToPossible(
      helpers.evaluateExpression(expression.right, env, depth + 1),
    );
  }

  return helpers.emptyEvaluation();
}
