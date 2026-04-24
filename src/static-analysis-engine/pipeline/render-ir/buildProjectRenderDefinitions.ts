import ts from "typescript";

import { collectExportedComponentDefinitions } from "./collection/discovery/collectExportedComponentDefinitions.js";
import { collectExportedHelperDefinitions } from "./collection/discovery/collectExportedHelperDefinitions.js";
import { collectSameFileComponents } from "./collection/discovery/collectSameFileComponents.js";
import type {
  LocalHelperDefinition,
  SameFileComponentDefinition,
} from "./collection/shared/types.js";

export type ProjectRenderDefinitions = {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
};

export function buildProjectRenderDefinitions(input: {
  parsedFiles: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
  }>;
}): ProjectRenderDefinitions {
  const componentDefinitionsByFilePath = new Map<string, SameFileComponentDefinition[]>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectSameFileComponents({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
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
        }),
      ]),
    ),
  };
}
