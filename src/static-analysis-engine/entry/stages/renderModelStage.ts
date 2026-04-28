import { buildRenderModel } from "../../pipeline/render-model/index.js";
import type {
  ModuleFactsStageResult,
  ParsedProjectFile,
  RenderModelStageResult,
  SymbolResolutionStageResult,
} from "./types.js";

export function runRenderModelStage(input: {
  parsedFiles: ParsedProjectFile[];
  symbolResolution: SymbolResolutionStageResult;
  moduleFacts: ModuleFactsStageResult["moduleFacts"];
  includeTraces?: boolean;
}): RenderModelStageResult {
  return buildRenderModel({
    ...input,
  });
}
