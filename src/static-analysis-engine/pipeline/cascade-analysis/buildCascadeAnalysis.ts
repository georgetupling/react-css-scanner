import type { FactGraphResult } from "../fact-graph/index.js";
import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
  SelectorBranchAnalysis,
} from "../project-evidence/index.js";
import type { RenderModel } from "../render-structure/index.js";
import type { RuntimeCssLoadingResult } from "../runtime-css-loading/index.js";
import type {
  SelectorBranchMatch,
  SelectorReachabilityResult,
} from "../selector-reachability/index.js";
import { buildCascadeAnalysisIndexes } from "./indexes.js";
import { cascadeDeclarationCandidateId, cascadeDiagnosticId } from "./ids.js";
import { getCssPropertyEffectsForDeclaration } from "./propertyEffects.js";
import { calculateSelectorSpecificity } from "./specificity.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisDiagnosticCode,
  CascadeAnalysisResult,
  CascadeDeclarationCandidate,
  CascadeConditionSet,
  CssDeclarationCascadeRecord,
} from "./types.js";
import { createConditionSet, mapMatchCertainty } from "./conditions.js";
import { buildOutcomes, compareById } from "./outcomes.js";
import {
  emitUnsupportedPropertyDiagnostics,
  resolveCustomPropertyDependentCandidates,
} from "./customPropertyResolution.js";
import { getDeclarationLayer } from "./cascadeKeys.js";
import { buildRuntimeStylesheetOrder } from "./runtimeStylesheetOrder.js";
import { buildInlineStyleCandidates } from "./inlineStyleCandidates.js";

export type CascadeAnalysisInput = {
  factGraph: FactGraphResult;
  projectEvidence: ProjectEvidenceAssemblyResult;
  renderModel: RenderModel;
  runtimeCssLoading: RuntimeCssLoadingResult;
  selectorReachability: SelectorReachabilityResult;
  options?: {
    includeTraces?: boolean;
  };
};

export function buildCascadeAnalysis(input: CascadeAnalysisInput): CascadeAnalysisResult {
  const includeTraces = input.options?.includeTraces ?? true;
  const diagnostics: CascadeAnalysisDiagnostic[] = [];
  const conditionSetsById = new Map<string, CascadeConditionSet>();
  const stylesheetOrderById = buildRuntimeStylesheetOrder(input);
  const declarations = input.projectEvidence.entities.cssDeclarations.map((declaration) => {
    const specificity = calculateSelectorSpecificity(declaration.selectorText);
    if (!specificity.supported) {
      diagnostics.push(
        createDiagnostic({
          code: "unsupported-selector-specificity",
          message: `Selector specificity could not be calculated for "${declaration.selectorText}".`,
          declarationId: declaration.id,
          location: declaration.location,
          traces: [],
        }),
      );
    }

    const stylesheetSourceOrder = stylesheetOrderById.get(declaration.stylesheetId);
    const layer = getDeclarationLayer(declaration.atRuleContext);
    return {
      declarationId: declaration.id,
      property: declaration.property,
      value: declaration.value,
      important: declaration.important,
      cascadeKey: {
        origin: "author",
        important: declaration.important,
        layer,
        specificity: specificity.specificity,
        sourceOrder:
          (stylesheetSourceOrder ?? 0) * 1_000_000 +
          declaration.ruleSourceOrder * 1000 +
          declaration.declarationIndex,
        orderKnown: stylesheetSourceOrder !== undefined,
      },
    } satisfies CssDeclarationCascadeRecord;
  });

  const candidates: CascadeDeclarationCandidate[] = [];
  for (const declaration of input.projectEvidence.entities.cssDeclarations) {
    if (!declaration.location) {
      diagnostics.push(
        createDiagnostic({
          code: "missing-declaration-location",
          message: `Declaration "${declaration.property}" has no source location.`,
          declarationId: declaration.id,
          traces: [],
        }),
      );
    }

    const declarationRecord = declarations.find(
      (record) => record.declarationId === declaration.id,
    );
    if (!declarationRecord) {
      continue;
    }

    for (const selectorBranchId of declaration.selectorBranchIds) {
      const selectorBranch =
        input.projectEvidence.indexes.selectorBranchesById.get(selectorBranchId);
      if (!selectorBranch) {
        diagnostics.push(
          createDiagnostic({
            code: "missing-selector-branch-match",
            message: `Declaration "${declaration.property}" could not be linked to selector branch evidence.`,
            declarationId: declaration.id,
            selectorBranchId,
            location: declaration.location,
            traces: [],
          }),
        );
        continue;
      }
      const branchSpecificity = calculateSelectorSpecificity(selectorBranch.selectorText);
      if (!branchSpecificity.supported) {
        diagnostics.push(
          createDiagnostic({
            code: "unsupported-selector-specificity",
            message: `Selector specificity could not be calculated for "${selectorBranch.selectorText}".`,
            declarationId: declaration.id,
            selectorBranchId,
            location: selectorBranch.location ?? declaration.location,
            traces: [],
          }),
        );
      }

      const propertyEffects = getCssPropertyEffectsForDeclaration(declaration);

      const matches = findMatchesForSelectorBranch(selectorBranch, input.selectorReachability);
      if (matches.length === 0) {
        diagnostics.push(
          createDiagnostic({
            code: "missing-selector-branch-match",
            message: `Selector branch "${selectorBranch.selectorText}" has no matched render elements for cascade analysis.`,
            declarationId: declaration.id,
            selectorBranchId,
            location: selectorBranch.location ?? declaration.location,
            traces: includeTraces ? selectorBranch.traces : [],
          }),
        );
        continue;
      }

      for (const match of matches) {
        const conditionSet = createConditionSet({
          declaration,
          selectorText: selectorBranch.selectorText,
          match,
          includeTraces,
        });
        conditionSetsById.set(conditionSet.id, conditionSet);
        for (const propertyEffect of propertyEffects) {
          candidates.push({
            id: cascadeDeclarationCandidateId({
              declarationId: declaration.id,
              selectorBranchId,
              elementId: match.subjectElementId,
              property: propertyEffect.property,
            }),
            declarationId: declaration.id,
            elementId: match.subjectElementId,
            selectorBranchId,
            property: propertyEffect.property,
            value: propertyEffect.value,
            declaredProperty: declaration.property,
            declaredValue: declaration.value,
            propertyEffectSource: propertyEffect.source,
            propertyEffectSupported: propertyEffect.supported,
            ...(propertyEffect.reason ? { propertyEffectReason: propertyEffect.reason } : {}),
            ...(propertyEffect.customPropertyDependencies
              ? { customPropertyDependencies: propertyEffect.customPropertyDependencies }
              : {}),
            cascadeKey: {
              ...declarationRecord.cascadeKey,
              specificity: branchSpecificity.specificity,
            },
            conditionSetId: conditionSet.id,
            matchCertainty: mapMatchCertainty(match.certainty),
            reasons: [
              `selector branch "${selectorBranch.selectorText}" matched rendered element`,
              ...(propertyEffect.source === "shorthand"
                ? [`"${declaration.property}" contributes to "${propertyEffect.property}"`]
                : []),
            ],
            traces: includeTraces ? match.traces : [],
          });
        }
      }
    }
  }

  candidates.push(
    ...buildInlineStyleCandidates({
      input,
      conditionSetsById,
      includeTraces,
      diagnostics,
      createDiagnostic,
    }),
  );

  const resolvedCandidates = resolveCustomPropertyDependentCandidates({
    candidates,
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

function findMatchesForSelectorBranch(
  selectorBranch: SelectorBranchAnalysis,
  selectorReachability: SelectorReachabilityResult,
): SelectorBranchMatch[] {
  const matchIds =
    selectorReachability.indexes.matchIdsBySelectorBranchNodeId.get(
      selectorBranch.selectorBranchNodeId,
    ) ?? [];
  return matchIds
    .map((matchId) => selectorReachability.indexes.matchById.get(matchId))
    .filter((match): match is SelectorBranchMatch => Boolean(match))
    .filter((match) => match.certainty !== "impossible")
    .sort(compareById);
}
