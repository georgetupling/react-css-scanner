import ts from "typescript";

import { unwrapExpression, withTextRange } from "./reactComponentAstUtils.js";

export function getRenderableRootExpression(body: ts.ConciseBody): ts.Expression | undefined {
  const expression = summarizeConciseBodyToExpression(body);
  return expression && isRenderableExpression(expression) ? expression : undefined;
}

function summarizeConciseBodyToExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) {
    return body;
  }

  return summarizeStatementSequenceAsReturnExpression(body.statements);
}

function summarizeStatementSequenceAsReturnExpression(
  statements: readonly ts.Statement[],
  localConstInitializers = new Map<string, ts.Expression>(),
): ts.Expression | undefined {
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];

    if (ts.isEmptyStatement(statement)) {
      continue;
    }

    if (ts.isFunctionDeclaration(statement)) {
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      collectConstInitializers(statement, localConstInitializers);
      continue;
    }

    if (ts.isIfStatement(statement)) {
      const ifExpression = summarizeIfStatementAsExpression(
        statement,
        statements.slice(index + 1),
        localConstInitializers,
      );
      if (ifExpression) {
        return ifExpression;
      }

      continue;
    }

    if (ts.isSwitchStatement(statement)) {
      const switchExpression = summarizeSwitchStatementAsExpression(
        statement,
        localConstInitializers,
      );
      if (switchExpression) {
        return switchExpression;
      }

      continue;
    }

    const returnExpression = summarizeStatementAsReturnExpression(
      statement,
      localConstInitializers,
    );
    if (returnExpression) {
      return returnExpression;
    }
  }

  return undefined;
}

function summarizeStatementAsReturnExpression(
  statement: ts.Statement,
  localConstInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  if (ts.isBlock(statement)) {
    return summarizeStatementSequenceAsReturnExpression(
      statement.statements,
      new Map(localConstInitializers),
    );
  }

  if (ts.isReturnStatement(statement) && statement.expression) {
    return resolveLocalConstIdentifierExpression(statement.expression, localConstInitializers);
  }

  if (ts.isSwitchStatement(statement)) {
    return summarizeSwitchStatementAsExpression(statement, localConstInitializers);
  }

  if (ts.isIfStatement(statement)) {
    return summarizeIfStatementAsExpression(statement, [], localConstInitializers);
  }

  if (ts.isEmptyStatement(statement)) {
    return withTextRange(ts.factory.createIdentifier("undefined"), statement);
  }

  return undefined;
}

function summarizeIfStatementAsExpression(
  statement: ts.IfStatement,
  subsequentStatements: readonly ts.Statement[],
  localConstInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  const whenTrue = summarizeStatementAsReturnExpression(
    statement.thenStatement,
    localConstInitializers,
  );
  if (!whenTrue) {
    return undefined;
  }

  const whenFalse = statement.elseStatement
    ? summarizeStatementAsReturnExpression(statement.elseStatement, localConstInitializers)
    : summarizeStatementSequenceAsReturnExpression(
        subsequentStatements,
        new Map(localConstInitializers),
      );
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

function summarizeSwitchStatementAsExpression(
  statement: ts.SwitchStatement,
  localConstInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  const caseGroups: Array<{
    labels: ts.Expression[];
    returnExpression: ts.Expression;
  }> = [];
  let pendingLabels: ts.Expression[] = [];
  let defaultExpression: ts.Expression | undefined;

  for (const clause of statement.caseBlock.clauses) {
    const clauseReturnExpression = summarizeSwitchClauseReturnExpression(
      clause.statements,
      localConstInitializers,
    );
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

    if (!clauseReturnExpression || pendingLabels.length > 0 || defaultExpression) {
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
      caseGroup.returnExpression,
    );
  }

  return withTextRange(fallbackExpression, statement);
}

function summarizeSwitchClauseReturnExpression(
  statements: readonly ts.Statement[],
  localConstInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  for (const statement of statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return resolveLocalConstIdentifierExpression(statement.expression, localConstInitializers);
    }

    if (ts.isBreakStatement(statement) || ts.isEmptyStatement(statement)) {
      continue;
    }

    return undefined;
  }

  return undefined;
}

function collectConstInitializers(
  statement: ts.VariableStatement,
  localConstInitializers: Map<string, ts.Expression>,
): void {
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
    return;
  }

  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
      localConstInitializers.set(declaration.name.text, declaration.initializer);
    }
  }
}

function resolveLocalConstIdentifierExpression(
  expression: ts.Expression,
  localConstInitializers: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>(),
): ts.Expression {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped)) {
    return expression;
  }

  const initializer = localConstInitializers.get(unwrapped.text);
  if (!initializer || seen.has(unwrapped.text)) {
    return expression;
  }

  seen.add(unwrapped.text);
  return resolveLocalConstIdentifierExpression(initializer, localConstInitializers, seen);
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

function isRenderableExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);

  return (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped) ||
    ts.isCallExpression(unwrapped) ||
    ts.isArrayLiteralExpression(unwrapped) ||
    ts.isConditionalExpression(unwrapped) ||
    isArrayMethodRenderableExpression(unwrapped) ||
    isLogicalRenderableExpression(unwrapped) ||
    isNullishRenderExpression(unwrapped)
  );
}

function isLogicalRenderableExpression(
  expression: ts.Expression,
): expression is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  );
}

function isArrayMethodRenderableExpression(
  expression: ts.Expression,
): expression is ts.CallExpression {
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    (expression.expression.name.text === "map" || expression.expression.name.text === "find")
  );
}

function isNullishRenderExpression(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    isUndefinedIdentifier(expression) ||
    (ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  );
}

function isUndefinedIdentifier(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === "undefined";
}
