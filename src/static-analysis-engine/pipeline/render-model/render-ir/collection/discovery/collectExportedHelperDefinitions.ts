import ts from "typescript";

import type { LocalHelperDefinition } from "../shared/types.js";
import type { FiniteTypeEvidenceCache } from "../shared/finiteTypeEvidence.js";
import { isDefaultExported, isExported, unwrapExpression } from "../shared/utils.js";
import { summarizeTopLevelHelperDefinition } from "../summarization/summarizeLocalHelperDefinition.js";

export function collectExportedHelperDefinitions(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  finiteTypeEvidenceCache?: FiniteTypeEvidenceCache;
}): Map<string, LocalHelperDefinition> {
  const helperDefinitions = new Map<string, LocalHelperDefinition>();
  const topLevelHelperDefinitions = collectTopLevelHelperDefinitions(input);

  for (const statement of input.parsedSourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const helperDefinition = topLevelHelperDefinitions.get(statement.name.text);
      if (!helperDefinition) {
        continue;
      }

      if (isExported(statement)) {
        helperDefinitions.set(helperDefinition.helperName, helperDefinition);
      }

      if (isDefaultExported(statement)) {
        helperDefinitions.set("default", helperDefinition);
      }

      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      const helperDefinition = topLevelHelperDefinitions.get(declaration.name.text);
      if (helperDefinition && isExported(statement)) {
        helperDefinitions.set(helperDefinition.helperName, helperDefinition);
      }
    }
  }

  for (const statement of input.parsedSourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) {
      continue;
    }

    if (!ts.isIdentifier(statement.expression)) {
      continue;
    }

    const helperDefinition = topLevelHelperDefinitions.get(statement.expression.text);
    if (helperDefinition) {
      helperDefinitions.set("default", helperDefinition);
    }
  }

  return helperDefinitions;
}

export function collectTopLevelHelperDefinitions(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  finiteTypeEvidenceCache?: FiniteTypeEvidenceCache;
}): Map<string, LocalHelperDefinition> {
  const topLevelHelperDefinitions = new Map<string, LocalHelperDefinition>();

  for (const statement of input.parsedSourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const helperDefinition = summarizeTopLevelHelperDefinition({
        helperName: statement.name.text,
        filePath: input.filePath,
        parsedSourceFile: input.parsedSourceFile,
        parameters: statement.parameters,
        body: statement.body,
        finiteTypeEvidenceCache: input.finiteTypeEvidenceCache,
      });
      if (!helperDefinition) {
        continue;
      }

      topLevelHelperDefinitions.set(helperDefinition.helperName, helperDefinition);

      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      const unwrappedInitializer = unwrapExpression(declaration.initializer);
      if (
        !ts.isArrowFunction(unwrappedInitializer) &&
        !ts.isFunctionExpression(unwrappedInitializer)
      ) {
        continue;
      }

      const helperDefinition = summarizeTopLevelHelperDefinition({
        helperName: declaration.name.text,
        filePath: input.filePath,
        parsedSourceFile: input.parsedSourceFile,
        parameters: unwrappedInitializer.parameters,
        body: unwrappedInitializer.body,
        finiteTypeEvidenceCache: input.finiteTypeEvidenceCache,
      });
      if (helperDefinition) {
        topLevelHelperDefinitions.set(helperDefinition.helperName, helperDefinition);
      }
    }
  }

  return topLevelHelperDefinitions;
}
