import {
  missingExpressionSyntaxDiagnostic,
  sortSymbolicEvaluationDiagnostics,
  unresolvedClassExpressionSiteDiagnostic,
} from "./diagnostics.js";
import { createLegacyAstExpressionStore } from "./adapters/legacyAstExpressionStore.js";
import { createLegacyRenderModelClassExpressionSummaryStore } from "./adapters/legacyRenderModelAdapter.js";
import { buildEvaluatedExpressionIndexes } from "./indexes.js";
import { createDefaultSymbolicEvaluatorRegistry } from "./registry.js";
import type { ClassExpressionSiteNode, ExpressionSyntaxNode } from "../fact-graph/index.js";
import type {
  CanonicalClassExpression,
  ConditionFact,
  SymbolicEvaluationDiagnostic,
  SymbolicEvaluationInput,
  SymbolicEvaluationResult,
} from "./types.js";

export function evaluateSymbolicExpressions(
  input: SymbolicEvaluationInput,
): SymbolicEvaluationResult {
  const legacyExpressionStore = input.legacy?.parsedFiles
    ? createLegacyAstExpressionStore({ parsedFiles: input.legacy.parsedFiles })
    : undefined;
  const legacyRenderModelSummaryStore = input.legacy?.renderModelClassExpressionSummaries
    ? createLegacyRenderModelClassExpressionSummaryStore({
        summaries: input.legacy.renderModelClassExpressionSummaries,
      })
    : undefined;
  const evaluatorRegistry =
    input.evaluatorRegistry ??
    createDefaultSymbolicEvaluatorRegistry({
      ...(legacyExpressionStore ? { legacyExpressionStore } : {}),
      ...(legacyRenderModelSummaryStore ? { legacyRenderModelSummaryStore } : {}),
    });
  const classExpressions: CanonicalClassExpression[] = [];
  const conditions: ConditionFact[] = [];
  const diagnostics: SymbolicEvaluationDiagnostic[] = [];
  const classExpressionSites = [...input.graph.nodes.classExpressionSites].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  for (const site of classExpressionSites) {
    const expressionSyntax = resolveExpressionSyntaxNode(input, site);

    if (!expressionSyntax) {
      diagnostics.push(missingExpressionSyntaxDiagnostic(site));
      continue;
    }

    const result = evaluatorRegistry.evaluate({
      graph: input.graph,
      classExpressionSite: site,
      expressionSyntax,
      options: input.options ?? {},
      ...(legacyExpressionStore ? { legacyExpressionStore } : {}),
      ...(legacyRenderModelSummaryStore ? { legacyRenderModelSummaryStore } : {}),
    });

    if (result.expression) {
      classExpressions.push(result.expression);
    }

    conditions.push(...(result.conditions ?? []));
    diagnostics.push(...(result.diagnostics ?? []));

    if (!result.expression && (result.diagnostics ?? []).length === 0) {
      diagnostics.push(unresolvedClassExpressionSiteDiagnostic(site));
    }
  }

  const sortedClassExpressions = [...classExpressions].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const sortedConditions = [...conditions].sort((left, right) => left.id.localeCompare(right.id));
  const indexResult = buildEvaluatedExpressionIndexes({
    classExpressions: sortedClassExpressions,
    conditions: sortedConditions,
  });
  const allDiagnostics = sortSymbolicEvaluationDiagnostics([
    ...diagnostics,
    ...indexResult.diagnostics,
  ]);

  return {
    graph: input.graph,
    evaluatedExpressions: {
      meta: {
        generatedAtStage: "symbolic-evaluation",
        classExpressionSiteCount: input.graph.nodes.classExpressionSites.length,
        evaluatedClassExpressionCount: sortedClassExpressions.length,
        diagnosticCount: allDiagnostics.length,
      },
      classExpressions: sortedClassExpressions,
      conditions: sortedConditions,
      diagnostics: allDiagnostics,
      indexes: indexResult.indexes,
    },
  };
}

function resolveExpressionSyntaxNode(
  input: SymbolicEvaluationInput,
  site: ClassExpressionSiteNode,
): ExpressionSyntaxNode | undefined {
  const expressionNode = input.graph.indexes.nodesById.get(site.expressionNodeId);

  if (expressionNode?.kind === "expression-syntax") {
    return expressionNode;
  }

  const indexedExpressionNodeId = input.graph.indexes.expressionSyntaxNodeIdByExpressionId?.get(
    site.expressionId,
  );
  const indexedExpressionNode = indexedExpressionNodeId
    ? input.graph.indexes.nodesById.get(indexedExpressionNodeId)
    : undefined;

  if (indexedExpressionNode?.kind === "expression-syntax") {
    return indexedExpressionNode;
  }

  const fallbackNode = input.graph.nodes.expressionSyntax.find(
    (node) => node.id === site.expressionNodeId || node.expressionId === site.expressionId,
  );
  return fallbackNode;
}
