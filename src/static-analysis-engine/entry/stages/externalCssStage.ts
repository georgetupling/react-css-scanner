import {
  buildExternalCssSummary,
  type ExternalCssAnalysisInput,
} from "../../pipeline/external-css/index.js";
import type { ExternalCssStageResult } from "./types.js";

export function runExternalCssStage(input: {
  externalCss?: ExternalCssAnalysisInput;
}): ExternalCssStageResult {
  return {
    externalCssSummary: buildExternalCssSummary(input.externalCss),
  };
}
