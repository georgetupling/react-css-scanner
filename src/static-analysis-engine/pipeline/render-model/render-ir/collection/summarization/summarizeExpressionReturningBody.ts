import ts from "typescript";

import {
  collectLocalBodyBindings,
  isConstDeclarationList,
} from "../shared/collectLocalBodyBindings.js";
import {
  summarizeIfStatementAsExpression,
  summarizeSwitchStatementAsExpression,
} from "./statementToReturnExpression.js";

export function summarizeExpressionReturningBody(
  body: ts.ConciseBody,
  finiteStringValuesByObjectName: Map<string, Map<string, string[]>> = new Map(),
):
  | {
      returnExpression: ts.Expression;
      localExpressionBindingEntries: import("../shared/types.js").ExpressionBindingEntry[];
      localExpressionBindings: Map<string, ts.Expression>;
      localStringSetBindings: Map<string, string[]>;
    }
  | undefined {
  if (!ts.isBlock(body)) {
    return {
      returnExpression: body,
      localExpressionBindingEntries: [],
      localExpressionBindings: new Map(),
      localStringSetBindings: new Map(),
    };
  }

  const localExpressionBindings = new Map<string, ts.Expression>();
  const localExpressionBindingEntries: import("../shared/types.js").ExpressionBindingEntry[] = [];
  const localStringSetBindings = new Map<string, string[]>();

  for (let index = 0; index < body.statements.length; index += 1) {
    const statement = body.statements[index];

    if (ts.isVariableStatement(statement) && isConstDeclarationList(statement.declarationList)) {
      collectLocalBodyBindings(
        statement.declarationList,
        localExpressionBindings,
        localStringSetBindings,
        new Map(),
        finiteStringValuesByObjectName,
        localExpressionBindingEntries,
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
          returnExpression: ifReturnExpression,
          localExpressionBindingEntries,
          localExpressionBindings,
          localStringSetBindings,
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
            localExpressionBindingEntries,
            localExpressionBindings,
            localStringSetBindings,
          };
        }
      }

      continue;
    }

    return {
      returnExpression: statement.expression,
      localExpressionBindingEntries,
      localExpressionBindings,
      localStringSetBindings,
    };
  }

  return undefined;
}
