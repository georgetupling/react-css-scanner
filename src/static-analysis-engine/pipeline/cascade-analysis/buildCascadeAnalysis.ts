import type { FactGraphResult } from "../fact-graph/index.js";
import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
} from "../project-evidence/index.js";
import type { RenderModel } from "../render-structure/index.js";
import type { RuntimeCssLoadingResult } from "../runtime-css-loading/index.js";
import type { SelectorReachabilityResult } from "../selector-reachability/index.js";
import type { SymbolicEvaluationResult } from "../symbolic-evaluation/index.js";
import { buildCascadeAnalysisIndexes } from "./indexes.js";
import { cascadeDiagnosticId } from "./ids.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisDiagnosticCode,
  CascadeAnalysisResult,
  CascadeDeclarationCandidate,
  CascadeConditionSet,
} from "./types.js";
import { compareById } from "./candidateComparison.js";
import { buildOutcomes } from "./outcomes.js";
import {
  emitUnsupportedPropertyDiagnostics,
  resolveCustomPropertyDependentCandidates,
} from "./customPropertyResolution.js";
import { resolveLogicalPropertyCandidates } from "./logicalPropertyResolution.js";
import { buildRuntimeStylesheetOrder } from "./runtimeStylesheetOrder.js";
import { buildInlineStyleCandidates } from "./inlineStyleCandidates.js";
import { buildGlobalLayerOrderByName } from "./cascadeKeys.js";
import {
  buildStylesheetCascadeDeclarations,
  buildStylesheetDeclarationCandidates,
} from "./stylesheetCandidates.js";

export type CascadeAnalysisInput = {
  factGraph: FactGraphResult;
  projectEvidence: ProjectEvidenceAssemblyResult;
  renderModel: RenderModel;
  runtimeCssLoading: RuntimeCssLoadingResult;
  selectorReachability: SelectorReachabilityResult;
  symbolicEvaluation: SymbolicEvaluationResult;
  options?: {
    includeTraces?: boolean;
  };
};

export function buildCascadeAnalysis(input: CascadeAnalysisInput): CascadeAnalysisResult {
  const includeTraces = input.options?.includeTraces ?? true;
  const diagnostics: CascadeAnalysisDiagnostic[] = [];
  const conditionSetsById = new Map<string, CascadeConditionSet>();
  const runtimeStylesheetOrder = buildRuntimeStylesheetOrder(input);
  const layerOrderByName = buildGlobalLayerOrderByName({
    factGraph: input.factGraph,
    projectEvidence: input.projectEvidence,
    runtimeStylesheetOrder,
  });
  const declarations = buildStylesheetCascadeDeclarations({
    projectEvidence: input.projectEvidence,
    stylesheetOrderById: runtimeStylesheetOrder.stylesheetOrderById,
    layerOrderByName,
    diagnostics,
    createDiagnostic,
  });

  const candidates: CascadeDeclarationCandidate[] = buildStylesheetDeclarationCandidates({
    projectEvidence: input.projectEvidence,
    renderModel: input.renderModel,
    runtimeStylesheetOrder,
    selectorReachability: input.selectorReachability,
    declarations,
    conditionSetsById,
    diagnostics,
    includeTraces,
    createDiagnostic,
  });

  candidates.push(
    ...buildInlineStyleCandidates({
      input,
      runtimeStylesheetOrder,
      conditionSetsById,
      includeTraces,
      diagnostics,
      createDiagnostic,
    }),
  );

  const customPropertyResolvedCandidates = resolveCustomPropertyDependentCandidates({
    candidates,
    projectEvidence: input.projectEvidence,
    conditionSetsById,
  });
  const resolvedCandidates = resolveLogicalPropertyCandidates({
    candidates: customPropertyResolvedCandidates,
    projectEvidence: input.projectEvidence,
    conditionSetsById,
  }).sort(compareById);
  emitUnsupportedPropertyDiagnostics({
    candidates: resolvedCandidates,
    projectEvidence: input.projectEvidence,
    diagnostics,
    createDiagnostic,
  });
  const outcomes = buildOutcomes({
    candidates: resolvedCandidates,
    projectEvidence: input.projectEvidence,
    conditionSetsById,
    diagnostics,
  });
  const sortedDiagnostics = diagnostics.sort(compareById);
  const sortedConditionSets = [...conditionSetsById.values()].sort(compareById);
  const sortedDeclarations = declarations.sort((left, right) =>
    left.declarationId.localeCompare(right.declarationId),
  );
  const sortedCandidates = resolvedCandidates.sort(compareById);
  const sortedOutcomes = outcomes.sort(compareById);

  return {
    declarations: sortedDeclarations,
    conditionSets: sortedConditionSets,
    candidates: sortedCandidates,
    outcomes: sortedOutcomes,
    diagnostics: sortedDiagnostics,
    indexes: buildCascadeAnalysisIndexes({
      declarations: sortedDeclarations,
      conditionSets: sortedConditionSets,
      candidates: sortedCandidates,
      outcomes: sortedOutcomes,
      diagnostics: sortedDiagnostics,
    }),
    meta: {
      generatedAtStage: "cascade-analysis",
      declarationCount: sortedDeclarations.length,
      conditionSetCount: sortedConditionSets.length,
      candidateCount: sortedCandidates.length,
      outcomeCount: sortedOutcomes.length,
      diagnosticCount: sortedDiagnostics.length,
    },
  };

  function createDiagnostic(input: {
    code: CascadeAnalysisDiagnosticCode;
    message: string;
    declarationId?: ProjectEvidenceId;
    selectorBranchId?: ProjectEvidenceId;
    elementId?: string;
    location?: CascadeAnalysisDiagnostic["location"];
    traces: CascadeAnalysisDiagnostic["traces"];
  }): CascadeAnalysisDiagnostic {
    return {
      id: cascadeDiagnosticId({
        code: input.code,
        declarationId: input.declarationId,
        selectorBranchId: input.selectorBranchId,
        elementId: input.elementId,
        index: diagnostics.length,
      }),
      code: input.code,
      severity: "debug",
      confidence: "high",
      message: input.message,
      ...(input.location ? { location: input.location } : {}),
      ...(input.declarationId ? { declarationId: input.declarationId } : {}),
      ...(input.selectorBranchId ? { selectorBranchId: input.selectorBranchId } : {}),
      ...(input.elementId ? { elementId: input.elementId } : {}),
      traces: includeTraces ? input.traces : [],
    };
  }
}
