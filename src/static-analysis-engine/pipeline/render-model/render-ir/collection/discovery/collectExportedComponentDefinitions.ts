import ts from "typescript";

import type { SameFileComponentDefinition } from "../shared/types.js";
import { isDefaultExported } from "../shared/utils.js";

export function collectExportedComponentDefinitions(input: {
  parsedSourceFile: ts.SourceFile;
  componentDefinitions: SameFileComponentDefinition[];
}): Map<string, SameFileComponentDefinition> {
  const exportedDefinitions = new Map<string, SameFileComponentDefinition>();
  const definitionsByName = new Map(
    input.componentDefinitions.map((definition) => [definition.componentName, definition]),
  );

  for (const definition of input.componentDefinitions) {
    if (definition.exported) {
      exportedDefinitions.set(definition.componentName, definition);
    }
  }

  for (const statement of input.parsedSourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      statement.body &&
      isDefaultExported(statement)
    ) {
      const definition = definitionsByName.get(statement.name.text);
      if (definition) {
        exportedDefinitions.set("default", definition);
      }

      continue;
    }

    if (!ts.isExportAssignment(statement) || statement.isExportEquals) {
      continue;
    }

    if (!ts.isIdentifier(statement.expression)) {
      continue;
    }

    const definition = definitionsByName.get(statement.expression.text);
    if (definition) {
      exportedDefinitions.set("default", definition);
    }
  }

  return exportedDefinitions;
}
