import { buildProjectBindingResolution } from "../../pipeline/symbol-resolution/index.js";
import type { SourceFrontendFacts } from "../../pipeline/language-frontends/index.js";
import type { ModuleFacts } from "../../pipeline/module-facts/index.js";
import type { ParsedProjectFile, SymbolResolutionStageResult } from "./types.js";

export function runSymbolResolutionStage(input: {
  source?: SourceFrontendFacts;
  parsedFiles?: ParsedProjectFile[];
  moduleFacts: ModuleFacts;
  includeTraces?: boolean;
}): SymbolResolutionStageResult {
  return buildProjectBindingResolution({
    source: input.source,
    parsedFiles: input.parsedFiles,
    moduleFacts: input.moduleFacts,
    includeTraces: input.includeTraces,
  });
}
