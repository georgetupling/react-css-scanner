import { toClassExpressionSummary } from "./classExpressionSummary.js";
import type { RuntimeDomClassReference } from "../../runtime-dom/index.js";
import type { SymbolicEvaluationResult } from "../types.js";

export function toRuntimeDomClassReferences(
  result: SymbolicEvaluationResult,
): RuntimeDomClassReference[] {
  return result.evaluatedExpressions.classExpressions
    .filter((expression) => expression.classExpressionSiteKind === "runtime-dom-class")
    .map((expression) => {
      const site = result.graph.indexes.nodesById.get(expression.classExpressionSiteNodeId);
      return {
        kind: "prosemirror-editor-view-attributes",
        filePath: expression.filePath,
        location: expression.location,
        rawExpressionText: expression.rawExpressionText,
        classExpression: toClassExpressionSummary(expression),
        ...(site?.kind === "class-expression-site" && site.runtimeDomLibraryHint
          ? { runtimeLibraryHint: site.runtimeDomLibraryHint }
          : {}),
      };
    });
}
