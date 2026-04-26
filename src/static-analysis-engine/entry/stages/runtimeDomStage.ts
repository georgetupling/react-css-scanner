import { analyzeRuntimeDomClasses } from "../../pipeline/runtime-dom/index.js";
import type { RuntimeDomStageResult, ParsedProjectFile } from "./types.js";

export function runRuntimeDomStage(input: {
  parsedFiles: ParsedProjectFile[];
  includeTraces?: boolean;
}): RuntimeDomStageResult {
  return {
    runtimeDomClassReferences: analyzeRuntimeDomClasses({
      parsedFiles: input.parsedFiles,
      includeTraces: input.includeTraces,
    }),
  };
}
