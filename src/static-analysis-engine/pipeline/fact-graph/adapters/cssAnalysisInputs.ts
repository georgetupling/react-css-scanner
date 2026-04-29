import type { CssStyleRuleFact } from "../../../types/css.js";
import type { FactGraph } from "../types.js";

export type FactGraphCssRuleFileInput = {
  filePath?: string;
  rules: CssStyleRuleFact[];
};

export function graphToCssRuleFileInputs(graph: FactGraph): FactGraphCssRuleFileInput[] {
  return graph.nodes.stylesheets.map((stylesheet) => ({
    filePath: stylesheet.filePath,
    rules: (graph.indexes.ruleDefinitionNodeIdsByStylesheetNodeId.get(stylesheet.id) ?? [])
      .map((ruleId) => graph.indexes.nodesById.get(ruleId))
      .filter((node) => node?.kind === "rule-definition")
      .map((node) => node.sourceRule),
  }));
}
