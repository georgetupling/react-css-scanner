import { buildModuleFacts } from "../../pipeline/module-facts/index.js";
import type {
  ProjectBoundary,
  ProjectResourceEdge,
} from "../../pipeline/workspace-discovery/index.js";
import type { ModuleFactsStageResult, ParsedProjectFile } from "./types.js";

export function runModuleFactsStage(input: {
  parsedFiles: ParsedProjectFile[];
  stylesheetFilePaths?: Iterable<string>;
  projectRoot?: string;
  boundaries?: ProjectBoundary[];
  resourceEdges?: ProjectResourceEdge[];
}): ModuleFactsStageResult {
  return {
    moduleFacts: buildModuleFacts({
      parsedFiles: input.parsedFiles,
      stylesheetFilePaths: input.stylesheetFilePaths,
      projectRoot: input.projectRoot,
      boundaries: input.boundaries,
      resourceEdges: input.resourceEdges,
    }),
  };
}
