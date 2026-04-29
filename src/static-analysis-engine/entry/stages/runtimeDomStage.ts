import { analyzeRuntimeDomClasses } from "../../pipeline/runtime-dom/index.js";
import type { SourceFrontendFacts } from "../../pipeline/language-frontends/index.js";
import type { RuntimeDomStageResult } from "./types.js";

export function runRuntimeDomStage(input: {
  source: SourceFrontendFacts;
  includeTraces?: boolean;
}): RuntimeDomStageResult {
  return {
    runtimeDomClassReferences: analyzeRuntimeDomClasses({
      source: input.source,
      includeTraces: input.includeTraces,
    }),
  };
}
