import ts from "typescript";

import { collectExportedComponentDefinitions } from "./collection/discovery/collectExportedComponentDefinitions.js";
import {
  collectExportedHelperDefinitions,
  collectTopLevelHelperDefinitions,
} from "./collection/discovery/collectExportedHelperDefinitions.js";
import { collectSameFileComponents } from "./collection/discovery/collectSameFileComponents.js";
import { indexExpressionBindingsBySymbolId } from "./collection/shared/indexExpressionBindingsBySymbolId.js";
import { createFiniteTypeInterpreterCache } from "./collection/shared/finiteTypeInterpreter.js";
import type { ModuleFacts } from "../../module-facts/index.js";
import type { ProjectBindingResolution } from "../../symbol-resolution/index.js";
import type {
  LocalHelperDefinition,
  SameFileComponentDefinition,
} from "./collection/shared/types.js";

export type ProjectRenderDefinitions = {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  topLevelHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  topLevelExpressionBindingsBySymbolIdByFilePath: Map<string, Map<string, ts.Expression>>;
};

export function buildProjectRenderDefinitions(input: {
  parsedFiles: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
  }>;
  moduleFacts: ModuleFacts;
  symbolResolution: ProjectBindingResolution;
}): ProjectRenderDefinitions {
  const finiteTypeInterpreterCache = createFiniteTypeInterpreterCache({
    moduleFacts: input.moduleFacts,
    parsedFiles: input.parsedFiles,
    symbolResolution: input.symbolResolution,
  });
  const componentDefinitionsByFilePath = new Map<string, SameFileComponentDefinition[]>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectSameFileComponents({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
        finiteTypeInterpreterCache,
        symbolResolution: input.symbolResolution,
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
          finiteTypeInterpreterCache,
          symbolResolution: input.symbolResolution,
        }),
      ]),
    ),
    topLevelHelperDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        collectTopLevelHelperDefinitions({
          filePath: parsedFile.filePath,
          parsedSourceFile: parsedFile.parsedSourceFile,
          finiteTypeInterpreterCache,
          symbolResolution: input.symbolResolution,
        }),
      ]),
    ),
    topLevelExpressionBindingsBySymbolIdByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => {
        const bindings = collectTopLevelExpressionBindings(parsedFile.parsedSourceFile);
        return [
          parsedFile.filePath,
          indexExpressionBindingsBySymbolId({
            bindingEntries: bindings.bindingEntries,
            filePath: parsedFile.filePath,
            parsedSourceFile: parsedFile.parsedSourceFile,
            symbolResolution: input.symbolResolution,
          }),
        ];
      }),
    ),
  };
}

function collectTopLevelExpressionBindings(parsedSourceFile: ts.SourceFile): {
  bindings: Map<string, ts.Expression>;
  bindingEntries: import("./collection/shared/types.js").ExpressionBindingEntry[];
} {
  const bindings = new Map<string, ts.Expression>();
  const bindingEntries: import("./collection/shared/types.js").ExpressionBindingEntry[] = [];

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
      bindingEntries.push({
        localName: declaration.name.text,
        declaration: declaration.name,
        expression: declaration.initializer,
      });
    }
  }

  return {
    bindings,
    bindingEntries,
  };
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
