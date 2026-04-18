import ts from "typescript";

import type { LocalHelperDefinition } from "./types.js";
import { unwrapExpression } from "./utils.js";
import { isRenderableExpression } from "./renderableExpressionGuards.js";

export function summarizeComponentBody(body: ts.ConciseBody):
  | {
      rootExpression: ts.Expression;
      localExpressionBindings: Map<string, ts.Expression>;
      localHelperDefinitions: Map<string, LocalHelperDefinition>;
    }
  | undefined {
  if (!ts.isBlock(body)) {
    return isRenderableExpression(body)
      ? {
          rootExpression: body,
          localExpressionBindings: new Map(),
          localHelperDefinitions: new Map(),
        }
      : undefined;
  }

  const localExpressionBindings = new Map<string, ts.Expression>();
  const localHelperDefinitions = new Map<string, LocalHelperDefinition>();

  for (let index = 0; index < body.statements.length; index += 1) {
    const statement = body.statements[index];

    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const helperDefinition = summarizeLocalHelperDefinition({
        helperName: statement.name.text,
        parameters: statement.parameters,
        body: statement.body,
      });
      if (helperDefinition) {
        localHelperDefinitions.set(helperDefinition.helperName, helperDefinition);
        continue;
      }
    }

    if (ts.isVariableStatement(statement) && isConstDeclarationList(statement.declarationList)) {
      collectLocalBindings(
        statement.declarationList,
        localExpressionBindings,
        localHelperDefinitions,
      );
      continue;
    }

    if (ts.isIfStatement(statement)) {
      const ifReturnExpression = summarizeIfStatementAsExpression(
        statement,
        body.statements.slice(index + 1),
      );
      if (ifReturnExpression) {
        return {
          rootExpression: ifReturnExpression,
          localExpressionBindings,
          localHelperDefinitions,
        };
      }

      continue;
    }

    if (!ts.isReturnStatement(statement) || !statement.expression) {
      if (ts.isSwitchStatement(statement)) {
        const switchReturnExpression = summarizeSwitchStatementAsExpression(statement);
        if (switchReturnExpression) {
          return {
            rootExpression: switchReturnExpression,
            localExpressionBindings,
            localHelperDefinitions,
          };
        }
      }

      continue;
    }

    if (isRenderableExpression(statement.expression)) {
      return {
        rootExpression: statement.expression,
        localExpressionBindings,
        localHelperDefinitions,
      };
    }
  }

  return undefined;
}

function collectLocalBindings(
  declarationList: ts.VariableDeclarationList,
  bindings: Map<string, ts.Expression>,
  localHelperDefinitions: Map<string, LocalHelperDefinition>,
): void {
  for (const declaration of declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      continue;
    }

    const helperDefinition = summarizeFunctionExpressionHelperDefinition(
      declaration.name.text,
      declaration.initializer,
    );
    if (helperDefinition) {
      localHelperDefinitions.set(helperDefinition.helperName, helperDefinition);
      continue;
    }

    bindings.set(declaration.name.text, declaration.initializer);
  }
}

function summarizeFunctionExpressionHelperDefinition(
  helperName: string,
  initializer: ts.Expression,
): LocalHelperDefinition | undefined {
  const unwrapped = unwrapExpression(initializer);
  if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) {
    return undefined;
  }

  return summarizeLocalHelperDefinition({
    helperName,
    parameters: unwrapped.parameters,
    body: unwrapped.body,
  });
}

function summarizeLocalHelperDefinition(input: {
  helperName: string;
  parameters: readonly ts.ParameterDeclaration[];
  body: ts.ConciseBody;
}): LocalHelperDefinition | undefined {
  const parameterNames: string[] = [];
  for (const parameter of input.parameters) {
    if (!ts.isIdentifier(parameter.name)) {
      return undefined;
    }

    parameterNames.push(parameter.name.text);
  }

  const bodySummary = summarizeExpressionReturningBody(input.body);
  if (!bodySummary) {
    return undefined;
  }

  return {
    helperName: input.helperName,
    parameterNames,
    returnExpression: bodySummary.returnExpression,
    localExpressionBindings: bodySummary.localExpressionBindings,
  };
}

function summarizeExpressionReturningBody(body: ts.ConciseBody):
  | {
      returnExpression: ts.Expression;
      localExpressionBindings: Map<string, ts.Expression>;
    }
  | undefined {
  if (!ts.isBlock(body)) {
    return {
      returnExpression: body,
      localExpressionBindings: new Map(),
    };
  }

  const localExpressionBindings = new Map<string, ts.Expression>();

  for (let index = 0; index < body.statements.length; index += 1) {
    const statement = body.statements[index];

    if (ts.isVariableStatement(statement) && isConstDeclarationList(statement.declarationList)) {
      collectLocalBindings(statement.declarationList, localExpressionBindings, new Map());
      continue;
    }

    if (ts.isIfStatement(statement)) {
      const ifReturnExpression = summarizeIfStatementAsExpression(
        statement,
        body.statements.slice(index + 1),
      );
      if (ifReturnExpression) {
        return {
          returnExpression: ifReturnExpression,
          localExpressionBindings,
        };
      }

      continue;
    }

    if (!ts.isReturnStatement(statement) || !statement.expression) {
      if (ts.isSwitchStatement(statement)) {
        const switchReturnExpression = summarizeSwitchStatementAsExpression(statement);
        if (switchReturnExpression) {
          return {
            returnExpression: switchReturnExpression,
            localExpressionBindings,
          };
        }
      }

      continue;
    }

    return {
      returnExpression: statement.expression,
      localExpressionBindings,
    };
  }

  return undefined;
}

function isConstDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
  return (declarationList.flags & ts.NodeFlags.Const) !== 0;
}

function summarizeSwitchStatementAsExpression(
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

function summarizeIfStatementAsExpression(
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

function summarizeStatementAsReturnExpression(statement: ts.Statement): ts.Expression | undefined {
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

function summarizeStatementSequenceAsReturnExpression(
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
