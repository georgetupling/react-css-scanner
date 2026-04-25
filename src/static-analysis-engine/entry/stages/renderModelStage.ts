import { buildRenderModel } from "../../pipeline/render-model/index.js";
import type {
  ParsedProjectFile,
  RenderModelStageResult,
  SymbolResolutionStageResult,
} from "./types.js";

export function runRenderModelStage(input: {
  parsedFiles: ParsedProjectFile[];
  symbolResolution: SymbolResolutionStageResult;
}): RenderModelStageResult {
  return buildRenderModel(input);
}
