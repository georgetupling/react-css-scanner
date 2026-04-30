import { canonicalClassExpressionId, unsupportedReasonId } from "../ids.js";
import { symbolicEvaluationProvenance } from "../diagnostics.js";
import { createSymbolicEvaluationTrace, traceList } from "../traces.js";
import type {
  CanonicalClassExpression,
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
} from "../types.js";

export const fallbackClassExpressionEvaluator: SymbolicExpressionEvaluator = {
  name: "fallback-class-expression",
  canEvaluate: () => true,
  evaluate(input) {
    return {
      expression: createFallbackClassExpression(input),
    };
  },
};

function createFallbackClassExpression(
  input: SymbolicExpressionEvaluatorInput,
): CanonicalClassExpression {
  const expressionId = canonicalClassExpressionId(input.classExpressionSite.id);
  const trace = createSymbolicEvaluationTrace({
    traceId: `symbolic-evaluation:fallback:${expressionId}`,
    summary: `Deferred symbolic evaluation for ${input.expressionSyntax?.expressionKind ?? "unknown"} expression`,
    anchor: input.expressionSyntax?.location ?? input.classExpressionSite.location,
    metadata: {
      evaluator: fallbackClassExpressionEvaluator.name,
      expressionKind: input.expressionSyntax?.expressionKind ?? "unknown",
    },
  });
  const traces = traceList({
    includeTraces: input.options.includeTraces,
    trace,
  });

  return {
    id: expressionId,
    classExpressionSiteNodeId: input.classExpressionSite.id,
    classExpressionSiteKind: input.classExpressionSite.classExpressionSiteKind,
    expressionNodeId: input.classExpressionSite.expressionNodeId,
    sourceExpressionKind: input.expressionSyntax?.expressionKind,
    filePath: input.classExpressionSite.filePath,
    location: input.classExpressionSite.location,
    rawExpressionText: input.classExpressionSite.rawExpressionText,
    expressionKind: "unknown",
    certainty: {
      kind: "unknown",
      summary: "no reliable token information",
    },
    confidence: "low",
    tokens: [],
    emissionVariants: [],
    externalContributions: [],
    cssModuleContributions: [],
    unsupported: [
      {
        id: unsupportedReasonId({
          expressionId,
          code: "unsupported-expression-kind",
          index: 0,
        }),
        kind: "unsupported-syntax",
        code: "unsupported-expression-kind",
        message: `No symbolic evaluator is wired for ${input.expressionSyntax?.expressionKind ?? "unknown"} expressions yet`,
        sourceAnchor: input.expressionSyntax?.location ?? input.classExpressionSite.location,
        recoverability: "none",
        confidence: "low",
      },
    ],
    tokenAnchors: {},
    ...(input.classExpressionSite.emittingComponentNodeId
      ? { emittingComponentNodeId: input.classExpressionSite.emittingComponentNodeId }
      : {}),
    ...(input.classExpressionSite.placementComponentNodeId
      ? { placementComponentNodeId: input.classExpressionSite.placementComponentNodeId }
      : {}),
    ...(input.classExpressionSite.renderSiteNodeId
      ? { renderSiteNodeId: input.classExpressionSite.renderSiteNodeId }
      : {}),
    ...(input.classExpressionSite.elementTemplateNodeId
      ? { elementTemplateNodeId: input.classExpressionSite.elementTemplateNodeId }
      : {}),
    provenance: symbolicEvaluationProvenance({
      summary: "Created fallback symbolic class expression",
      filePath: input.classExpressionSite.filePath,
      anchor: input.classExpressionSite.location,
      upstreamId: input.classExpressionSite.id,
    }),
    traces,
  };
}
