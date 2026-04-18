import ts from "typescript";

import {
  collectLocalBodyBindings,
  isConstDeclarationList,
} from "../shared/collectLocalBodyBindings.js";
import {
  summarizeIfStatementAsExpression,
  summarizeSwitchStatementAsExpression,
} from "./statementToReturnExpression.js";

export function summarizeExpressionReturningBody(body: ts.ConciseBody):
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
      collectLocalBodyBindings(statement.declarationList, localExpressionBindings, new Map());
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
