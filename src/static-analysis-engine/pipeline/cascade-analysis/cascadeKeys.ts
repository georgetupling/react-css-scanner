import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import type { CascadeDeclarationCandidate } from "./types.js";

export function getDeclarationLayer(
  atRuleContext: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number]["atRuleContext"],
): CascadeDeclarationCandidate["cascadeKey"]["layer"] {
  const layerContext = findInnermostLayerContext(atRuleContext);
  if (!layerContext) {
    return {
      known: true,
      unlayered: true,
    };
  }
  return {
    ...(layerContext.layerName ? { name: layerContext.layerName } : {}),
    ...(layerContext.layerOrder !== undefined ? { order: layerContext.layerOrder } : {}),
    known: layerContext.layerOrderKnown === true && layerContext.layerOrder !== undefined,
    unlayered: false,
  };
}

function findInnermostLayerContext(
  atRuleContext: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number]["atRuleContext"],
) {
  for (let index = atRuleContext.length - 1; index >= 0; index -= 1) {
    if (atRuleContext[index].name === "layer") {
      return atRuleContext[index];
    }
  }
  return undefined;
}
