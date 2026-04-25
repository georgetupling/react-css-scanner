import { buildModuleGraphFromSources } from "../../pipeline/module-graph/index.js";
import type { ModuleGraphStageResult, ParsedProjectFile } from "./types.js";

export function runModuleGraphStage(input: {
  parsedFiles: ParsedProjectFile[];
}): ModuleGraphStageResult {
  return {
    moduleGraph: buildModuleGraphFromSources(
      input.parsedFiles.map((parsedFile) => ({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
      })),
    ),
  };
}
