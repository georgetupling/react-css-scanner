import ts from "typescript";

import { collectExportedComponentDefinitions } from "./collection/discovery/collectExportedComponentDefinitions.js";
import {
  collectExportedHelperDefinitions,
  collectTopLevelHelperDefinitions,
} from "./collection/discovery/collectExportedHelperDefinitions.js";
import { collectSameFileComponents } from "./collection/discovery/collectSameFileComponents.js";
import { createFiniteTypeEvidenceCache } from "./collection/shared/finiteTypeEvidence.js";
import type { ModuleFacts } from "../../module-facts/index.js";
import type {
  LocalHelperDefinition,
  SameFileComponentDefinition,
} from "./collection/shared/types.js";

export type ProjectRenderDefinitions = {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  topLevelHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  topLevelExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
};

export function buildProjectRenderDefinitions(input: {
  parsedFiles: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
  }>;
  projectResolution: ModuleFacts;
}): ProjectRenderDefinitions {
  const finiteTypeEvidenceCache = createFiniteTypeEvidenceCache({
    moduleFacts: input.projectResolution,
    parsedFiles: input.parsedFiles,
  });
  const componentDefinitionsByFilePath = new Map<string, SameFileComponentDefinition[]>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectSameFileComponents({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
        finiteTypeEvidenceCache,
      }),
    ]),
  );

  return {
    componentDefinitionsByFilePath,
    exportedComponentsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        collectExportedComponentDefinitions({
          parsedSourceFile: parsedFile.parsedSourceFile,
          componentDefinitions: componentDefinitionsByFilePath.get(parsedFile.filePath) ?? [],
        }),
      ]),
    ),
    exportedHelperDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        collectExportedHelperDefinitions({
          filePath: parsedFile.filePath,
          parsedSourceFile: parsedFile.parsedSourceFile,
          finiteTypeEvidenceCache,
        }),
      ]),
    ),
    topLevelHelperDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        collectTopLevelHelperDefinitions({
          filePath: parsedFile.filePath,
          parsedSourceFile: parsedFile.parsedSourceFile,
          finiteTypeEvidenceCache,
        }),
      ]),
    ),
    topLevelExpressionBindingsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        collectTopLevelExpressionBindings(parsedFile.parsedSourceFile),
      ]),
    ),
  };
}

function collectTopLevelExpressionBindings(
  parsedSourceFile: ts.SourceFile,
): Map<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>();

  for (const statement of parsedSourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !isConstDeclarationList(statement.declarationList)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      if (isFunctionLikeExpression(declaration.initializer)) {
        continue;
      }

      bindings.set(declaration.name.text, declaration.initializer);
    }
  }

  return bindings;
}

function isConstDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
  return (declarationList.flags & ts.NodeFlags.Const) !== 0;
}

function isFunctionLikeExpression(expression: ts.Expression): boolean {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}
