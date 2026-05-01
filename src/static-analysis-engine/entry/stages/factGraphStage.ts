import { buildFactGraph } from "../../pipeline/fact-graph/index.js";
import type { LanguageFrontendsResult } from "../../pipeline/language-frontends/index.js";
import type { ProjectSnapshot } from "../../pipeline/workspace-discovery/index.js";
import type { FactGraphStageResult } from "./types.js";

export function runFactGraphStage(input: {
  workspaceDiscovery: ProjectSnapshot;
  frontends: LanguageFrontendsResult;
  includeTraces?: boolean;
}): FactGraphStageResult {
  return buildFactGraph({
    snapshot: input.workspaceDiscovery,
    frontends: input.frontends,
    includeTraces: input.includeTraces,
  });
}
