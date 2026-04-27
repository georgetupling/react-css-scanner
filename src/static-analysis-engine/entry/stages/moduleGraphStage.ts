import { buildModuleGraphFromSources } from "../../pipeline/module-graph/index.js";
import type {
  ModuleGraphStageResult,
  ParsedProjectFile,
  ProjectResolutionStageResult,
} from "./types.js";

export function runModuleGraphStage(input: {
  parsedFiles: ParsedProjectFile[];
  projectResolution: ProjectResolutionStageResult["projectResolution"];
}): ModuleGraphStageResult {
  return {
    moduleGraph: buildModuleGraphFromSources(
      input.parsedFiles.map((parsedFile) => ({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
      })),
      {
        projectResolution: input.projectResolution,
      },
    ),
  };
}
