import type { ClassExpressionSiteNode, FactNodeId } from "../fact-graph/index.js";
import type { SymbolicEvaluationDiagnostic, SymbolicEvaluationProvenance } from "./types.js";

export function symbolicEvaluationProvenance(input: {
  summary: string;
  filePath?: string;
  anchor?: ClassExpressionSiteNode["location"];
  upstreamId?: string;
}): SymbolicEvaluationProvenance[] {
  return [
    {
      stage: "symbolic-evaluation",
      summary: input.summary,
      ...(input.filePath ? { filePath: input.filePath } : {}),
      ...(input.anchor ? { anchor: input.anchor } : {}),
      ...(input.upstreamId ? { upstreamId: input.upstreamId } : {}),
    },
  ];
}

export function missingExpressionSyntaxDiagnostic(
  site: ClassExpressionSiteNode,
): SymbolicEvaluationDiagnostic {
  return {
    stage: "symbolic-evaluation",
    severity: "warning",
    code: "missing-expression-syntax",
    message: `Class expression site ${site.id} does not have a matching expression syntax node`,
    filePath: site.filePath,
    location: site.location,
    classExpressionSiteNodeId: site.id,
    provenance: symbolicEvaluationProvenance({
      summary: "Could not resolve graph expression syntax for class expression site",
      filePath: site.filePath,
      anchor: site.location,
      upstreamId: site.id,
    }),
  };
}

export function unresolvedClassExpressionSiteDiagnostic(
  site: ClassExpressionSiteNode,
): SymbolicEvaluationDiagnostic {
  return {
    stage: "symbolic-evaluation",
    severity: "warning",
    code: "unresolved-class-expression-site",
    message: `Class expression site ${site.id} was not evaluated by any symbolic evaluator`,
    filePath: site.filePath,
    location: site.location,
    classExpressionSiteNodeId: site.id,
    provenance: symbolicEvaluationProvenance({
      summary: "No symbolic evaluator produced a result for class expression site",
      filePath: site.filePath,
      anchor: site.location,
      upstreamId: site.id,
    }),
  };
}

export function duplicateEvaluatedExpressionIdDiagnostic(input: {
  expressionId: string;
  classExpressionSiteNodeId?: FactNodeId;
}): SymbolicEvaluationDiagnostic {
  return {
    stage: "symbolic-evaluation",
    severity: "error",
    code: "duplicate-evaluated-expression-id",
    message: `Duplicate evaluated class expression id: ${input.expressionId}`,
    ...(input.classExpressionSiteNodeId
      ? { classExpressionSiteNodeId: input.classExpressionSiteNodeId }
      : {}),
    provenance: symbolicEvaluationProvenance({
      summary: "Detected duplicate evaluated class expression id",
      upstreamId: input.classExpressionSiteNodeId,
    }),
  };
}

export function sortSymbolicEvaluationDiagnostics(
  diagnostics: SymbolicEvaluationDiagnostic[],
): SymbolicEvaluationDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const leftKey = diagnosticSortKey(left);
    const rightKey = diagnosticSortKey(right);
    return leftKey.localeCompare(rightKey);
  });
}

function diagnosticSortKey(diagnostic: SymbolicEvaluationDiagnostic): string {
  return [
    diagnostic.classExpressionSiteNodeId ?? "",
    diagnostic.filePath ?? "",
    diagnostic.location?.startLine ?? 0,
    diagnostic.location?.startColumn ?? 0,
    diagnostic.code,
    diagnostic.message,
  ].join("\0");
}
