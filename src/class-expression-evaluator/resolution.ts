import ts from "typescript";
import type { ClassReferenceFact } from "../facts/types.js";
import type { ClassExpressionEvaluationContext, EvaluationEnvironment } from "./types.js";

export function resolveIdentifierExpression(
  expression: ts.Identifier,
  context: ClassExpressionEvaluationContext,
  env: EvaluationEnvironment,
): ts.Expression | undefined {
  const envValue = env.get(expression.text);
  if (envValue) {
    return envValue;
  }

  return context.localBindings.get(expression.text);
}

export function resolveStaticClassValue(
  expression: ts.Expression,
  context: ClassExpressionEvaluationContext,
  env: EvaluationEnvironment,
  seenIdentifiers: Set<string>,
):
  | {
      value: string;
      kind: ClassReferenceFact["kind"];
      confidence: ClassReferenceFact["confidence"];
    }
  | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return {
      value: expression.text,
      kind: "string-literal",
      confidence: "high",
    };
  }

  if (ts.isParenthesizedExpression(expression)) {
    return resolveStaticClassValue(expression.expression, context, env, seenIdentifiers);
  }

  if (ts.isIdentifier(expression)) {
    if (seenIdentifiers.has(expression.text)) {
      return undefined;
    }

    const initializer = resolveIdentifierExpression(expression, context, env);
    if (!initializer) {
      return undefined;
    }

    seenIdentifiers.add(expression.text);
    const resolved = resolveStaticClassValue(initializer, context, env, seenIdentifiers);
    seenIdentifiers.delete(expression.text);
    return resolved;
  }

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;

    for (const span of expression.templateSpans) {
      const resolvedSpan = resolveStaticClassValue(span.expression, context, env, seenIdentifiers);
      if (!resolvedSpan) {
        return undefined;
      }

      value += resolvedSpan.value;
      value += span.literal.text;
    }

    return {
      value,
      kind: "template-literal",
      confidence: "high",
    };
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStaticClassValue(expression.left, context, env, seenIdentifiers);
    const right = resolveStaticClassValue(expression.right, context, env, seenIdentifiers);
    if (!left || !right) {
      return undefined;
    }

    return {
      value: `${left.value}${right.value}`,
      kind: "template-literal",
      confidence: "high",
    };
  }

  if (ts.isConditionalExpression(expression)) {
    const condition = resolveBooleanValue(expression.condition, context, env, seenIdentifiers);
    if (condition === true) {
      return resolveStaticClassValue(expression.whenTrue, context, env, seenIdentifiers);
    }

    if (condition === false) {
      return resolveStaticClassValue(expression.whenFalse, context, env, seenIdentifiers);
    }
  }

  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const condition = resolveBooleanValue(expression.left, context, env, seenIdentifiers);
      if (condition === true) {
        return resolveStaticClassValue(expression.right, context, env, seenIdentifiers);
      }

      if (condition === false) {
        return {
          value: "",
          kind: "expression-evaluated",
          confidence: "high",
        };
      }
    }

    if (
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const condition = resolveBooleanValue(expression.left, context, env, seenIdentifiers);
      if (condition === true) {
        return resolveStaticClassValue(expression.left, context, env, seenIdentifiers);
      }

      if (condition === false) {
        return resolveStaticClassValue(expression.right, context, env, seenIdentifiers);
      }
    }
  }

  return undefined;
}

export function resolveBooleanValue(
  expression: ts.Expression,
  context: ClassExpressionEvaluationContext,
  env: EvaluationEnvironment,
  seenIdentifiers: Set<string>,
): boolean | undefined {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return false;
  }

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text.length > 0;
  }

  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text) !== 0;
  }

  if (ts.isIdentifier(expression)) {
    if (seenIdentifiers.has(expression.text)) {
      return undefined;
    }

    const initializer = resolveIdentifierExpression(expression, context, env);
    if (!initializer) {
      return undefined;
    }

    seenIdentifiers.add(expression.text);
    const resolved = resolveBooleanValue(initializer, context, env, seenIdentifiers);
    seenIdentifiers.delete(expression.text);
    return resolved;
  }

  if (ts.isParenthesizedExpression(expression)) {
    return resolveBooleanValue(expression.expression, context, env, seenIdentifiers);
  }

  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const resolved = resolveBooleanValue(expression.operand, context, env, seenIdentifiers);
    return resolved === undefined ? undefined : !resolved;
  }

  return undefined;
}

export function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}
