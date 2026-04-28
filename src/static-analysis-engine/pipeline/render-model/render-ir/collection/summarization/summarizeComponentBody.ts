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
import type { SameFileComponentDefinition } from "../shared/types.js";

export function summarizeComponentBody(
  body: ts.ConciseBody,
  parameterBinding: SameFileComponentDefinition["parameterBinding"],
):
  | {
      rootExpression: ts.Expression;
      localExpressionBindingEntries: import("../shared/types.js").ExpressionBindingEntry[];
      localExpressionBindings: Map<string, ts.Expression>;
      localStringSetBindings: Map<string, string[]>;
      localHelperDefinitions: Map<string, LocalHelperDefinition>;
    }
  | undefined {
  if (!ts.isBlock(body)) {
    return isRenderableExpression(body)
      ? {
          rootExpression: body,
          localExpressionBindingEntries: [],
          localExpressionBindings: new Map(),
          localStringSetBindings: new Map(),
          localHelperDefinitions: new Map(),
        }
      : undefined;
  }

  const localExpressionBindings = new Map<string, ts.Expression>();
  const localExpressionBindingEntries: import("../shared/types.js").ExpressionBindingEntry[] = [];
  const localStringSetBindings = new Map<string, string[]>();
  const localHelperDefinitions = new Map<string, LocalHelperDefinition>();
  const finiteStringValuesByObjectName = buildFiniteStringValuesByObjectName(parameterBinding);

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
        localStringSetBindings,
        localHelperDefinitions,
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
          rootExpression: ifReturnExpression,
          localExpressionBindingEntries,
          localExpressionBindings,
          localStringSetBindings,
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
            localExpressionBindingEntries,
            localExpressionBindings,
            localStringSetBindings,
            localHelperDefinitions,
          };
        }
      }

      continue;
    }

    if (isRenderableExpression(statement.expression)) {
      return {
        rootExpression: statement.expression,
        localExpressionBindingEntries,
        localExpressionBindings,
        localStringSetBindings,
        localHelperDefinitions,
      };
    }
  }

  return undefined;
}

export { summarizeTopLevelHelperDefinition };

function buildFiniteStringValuesByObjectName(
  parameterBinding: SameFileComponentDefinition["parameterBinding"],
): Map<string, Map<string, string[]>> {
  if (
    parameterBinding.kind !== "props-identifier" ||
    !parameterBinding.finiteStringValuesByProperty
  ) {
    return new Map();
  }

  return new Map([
    [parameterBinding.identifierName, parameterBinding.finiteStringValuesByProperty],
  ]);
}
