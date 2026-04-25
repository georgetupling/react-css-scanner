import ts from "typescript";

import { isRenderableExpression } from "../shared/renderableExpressionGuards.js";

export function summarizeSwitchStatementAsExpression(
  statement: ts.SwitchStatement,
): ts.Expression | undefined {
  const caseGroups: Array<{
    labels: ts.Expression[];
    returnExpression: ts.Expression;
  }> = [];
  let pendingLabels: ts.Expression[] = [];
  let defaultExpression: ts.Expression | undefined;

  for (const clause of statement.caseBlock.clauses) {
    const clauseReturnExpression = summarizeSwitchClauseReturnExpression(clause.statements);
    if (ts.isCaseClause(clause)) {
      if (!clauseReturnExpression) {
        if (clause.statements.length === 0) {
          pendingLabels.push(clause.expression);
          continue;
        }

        return undefined;
      }

      caseGroups.push({
        labels: [...pendingLabels, clause.expression],
        returnExpression: clauseReturnExpression,
      });
      pendingLabels = [];
      continue;
    }

    if (!clauseReturnExpression) {
      return undefined;
    }

    if (pendingLabels.length > 0 || defaultExpression) {
      return undefined;
    }

    defaultExpression = clauseReturnExpression;
  }

  if (pendingLabels.length > 0) {
    return undefined;
  }

  let fallbackExpression =
    defaultExpression ?? withTextRange(ts.factory.createIdentifier("undefined"), statement);
  for (let index = caseGroups.length - 1; index >= 0; index -= 1) {
    const caseGroup = caseGroups[index];
    fallbackExpression = withTextRange(
      ts.factory.createConditionalExpression(
        buildSwitchCaseCondition(statement.expression, caseGroup.labels, statement),
        ts.factory.createToken(ts.SyntaxKind.QuestionToken),
        caseGroup.returnExpression,
        ts.factory.createToken(ts.SyntaxKind.ColonToken),
        fallbackExpression,
      ),
      statement,
    );
  }

  return withTextRange(fallbackExpression, statement);
}

export function summarizeIfStatementAsExpression(
  statement: ts.IfStatement,
  subsequentStatements: readonly ts.Statement[],
): ts.Expression | undefined {
  const whenTrue = summarizeStatementAsReturnExpression(statement.thenStatement);
  if (!whenTrue) {
    return undefined;
  }

  const whenFalse = statement.elseStatement
    ? summarizeStatementAsReturnExpression(statement.elseStatement)
    : summarizeStatementSequenceAsReturnExpression(subsequentStatements);
  if (!whenFalse) {
    return undefined;
  }

  return withTextRange(
    ts.factory.createConditionalExpression(
      statement.expression,
      ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      whenTrue,
      ts.factory.createToken(ts.SyntaxKind.ColonToken),
      whenFalse,
    ),
    statement,
  );
}

export function summarizeStatementAsReturnExpression(
  statement: ts.Statement,
): ts.Expression | undefined {
  if (ts.isBlock(statement)) {
    return summarizeStatementSequenceAsReturnExpression(statement.statements);
  }

  if (ts.isReturnStatement(statement) && statement.expression) {
    return isRenderableExpression(statement.expression) ? statement.expression : undefined;
  }

  if (ts.isSwitchStatement(statement)) {
    return summarizeSwitchStatementAsExpression(statement);
  }

  if (ts.isIfStatement(statement)) {
    return summarizeIfStatementAsExpression(statement, []);
  }

  if (ts.isEmptyStatement(statement)) {
    return withTextRange(ts.factory.createIdentifier("undefined"), statement);
  }

  return undefined;
}

export function summarizeStatementSequenceAsReturnExpression(
  statements: readonly ts.Statement[],
): ts.Expression | undefined {
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];

    if (ts.isEmptyStatement(statement)) {
      continue;
    }

    if (ts.isIfStatement(statement)) {
      return summarizeIfStatementAsExpression(statement, statements.slice(index + 1));
    }

    const returnExpression = summarizeStatementAsReturnExpression(statement);
    if (returnExpression) {
      return returnExpression;
    }

    return undefined;
  }

  return undefined;
}

function summarizeSwitchClauseReturnExpression(
  statements: readonly ts.Statement[],
): ts.Expression | undefined {
  for (const statement of statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return isRenderableExpression(statement.expression) ? statement.expression : undefined;
    }

    if (ts.isBreakStatement(statement) || ts.isEmptyStatement(statement)) {
      continue;
    }

    return undefined;
  }

  return undefined;
}

function buildSwitchCaseCondition(
  discriminant: ts.Expression,
  labels: readonly ts.Expression[],
  anchorNode: ts.Node,
): ts.Expression {
  let condition = withTextRange(
    ts.factory.createBinaryExpression(
      discriminant,
      ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
      labels[0],
    ),
    anchorNode,
  );

  for (let index = 1; index < labels.length; index += 1) {
    condition = withTextRange(
      ts.factory.createBinaryExpression(
        condition,
        ts.factory.createToken(ts.SyntaxKind.BarBarToken),
        withTextRange(
          ts.factory.createBinaryExpression(
            discriminant,
            ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            labels[index],
          ),
          anchorNode,
        ),
      ),
      anchorNode,
    );
  }

  return condition;
}

function withTextRange<T extends ts.Node>(node: T, anchorNode: ts.Node): T {
  return ts.setTextRange(node, anchorNode);
}
