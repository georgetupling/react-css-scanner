import ts from "typescript";

import { collectExportedComponentDefinitions } from "./collection/discovery/collectExportedComponentDefinitions.js";
import {
  collectExportedHelperDefinitions,
  collectTopLevelHelperDefinitions,
} from "./collection/discovery/collectExportedHelperDefinitions.js";
import { collectSameFileComponents } from "./collection/discovery/collectSameFileComponents.js";
import { createFiniteTypeEvidenceCache } from "./collection/shared/finiteTypeEvidence.js";
import type {
  LocalHelperDefinition,
  SameFileComponentDefinition,
} from "./collection/shared/types.js";

export type ProjectRenderDefinitions = {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  topLevelHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
};

export function buildProjectRenderDefinitions(input: {
  parsedFiles: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
  }>;
}): ProjectRenderDefinitions {
  const finiteTypeEvidenceCache = createFiniteTypeEvidenceCache(input.parsedFiles);
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
  };
}
