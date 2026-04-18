import ts from "typescript";

import type { LocalHelperDefinition } from "../shared/types.js";
import { isRenderableExpression } from "../shared/renderableExpressionGuards.js";
import {
  collectLocalBodyBindings,
  isConstDeclarationList,
} from "../shared/collectLocalBodyBindings.js";
import {
  summarizeLocalHelperDefinition,
  summarizeTopLevelHelperDefinition,
} from "./summarizeLocalHelperDefinition.js";
import {
  summarizeIfStatementAsExpression,
  summarizeSwitchStatementAsExpression,
} from "./statementToReturnExpression.js";

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
        filePath: statement.getSourceFile().fileName,
        parsedSourceFile: statement.getSourceFile(),
        parameters: statement.parameters,
        body: statement.body,
      });
      if (helperDefinition) {
        localHelperDefinitions.set(helperDefinition.helperName, helperDefinition);
        continue;
      }
    }

    if (ts.isVariableStatement(statement) && isConstDeclarationList(statement.declarationList)) {
      collectLocalBodyBindings(
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

export { summarizeTopLevelHelperDefinition };
