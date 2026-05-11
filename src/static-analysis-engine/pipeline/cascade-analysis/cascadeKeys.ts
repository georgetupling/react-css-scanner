import type { FactGraphResult } from "../fact-graph/index.js";
import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import type { RuntimeStylesheetOrder } from "./runtimeStylesheetOrder.js";
import type { CascadeDeclarationCandidate } from "./types.js";

export function getDeclarationLayer(
  atRuleContext: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number]["atRuleContext"],
  layerOrderByName?: Map<string, number>,
): CascadeDeclarationCandidate["cascadeKey"]["layer"] {
  const layerContext = findInnermostLayerContext(atRuleContext);
  if (!layerContext) {
    return {
      known: true,
      unlayered: true,
    };
  }
  const globalLayerOrder =
    layerContext.layerName && layerOrderByName?.has(layerContext.layerName)
      ? layerOrderByName.get(layerContext.layerName)
      : undefined;
  return {
    ...(layerContext.layerName ? { name: layerContext.layerName } : {}),
    ...(globalLayerOrder !== undefined
      ? { order: globalLayerOrder }
      : layerContext.layerOrder !== undefined
        ? { order: layerContext.layerOrder }
        : {}),
    known:
      globalLayerOrder !== undefined ||
      (layerContext.layerOrderKnown === true && layerContext.layerOrder !== undefined),
    unlayered: false,
  };
}

export function buildGlobalLayerOrderByName(input: {
  factGraph: FactGraphResult;
  projectEvidence: ProjectEvidenceAssemblyResult;
  runtimeStylesheetOrder: RuntimeStylesheetOrder;
}): Map<string, number> {
  const layerOrderByName = new Map<string, number>();
  const stylesheets = [...input.factGraph.graph.nodes.stylesheets]
    .map((stylesheet) => {
      const stylesheetId = stylesheet.filePath
        ? input.projectEvidence.indexes.stylesheetIdByPath.get(stylesheet.filePath)
        : undefined;
      const stylesheetOrder = stylesheetId
        ? input.runtimeStylesheetOrder.stylesheetOrderById.get(stylesheetId)
        : undefined;
      return {
        stylesheet,
        stylesheetOrder,
      };
    })
    .filter(
      (entry): entry is typeof entry & { stylesheetOrder: number } =>
        entry.stylesheetOrder !== undefined,
    )
    .sort(
      (left, right) =>
        left.stylesheetOrder - right.stylesheetOrder ||
        (left.stylesheet.filePath ?? "").localeCompare(right.stylesheet.filePath ?? ""),
    );

  for (const { stylesheet } of stylesheets) {
    for (const statement of [...stylesheet.layerOrderStatements].sort(
      (left, right) => left.sourceOrder - right.sourceOrder,
    )) {
      for (const layerName of statement.layerNames) {
        if (!layerOrderByName.has(layerName)) {
          layerOrderByName.set(layerName, layerOrderByName.size);
        }
      }
    }
  }

  return layerOrderByName;
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
