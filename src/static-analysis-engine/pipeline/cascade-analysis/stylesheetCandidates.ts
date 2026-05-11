import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
  SelectorBranchAnalysis,
} from "../project-evidence/index.js";
import type {
  SelectorBranchMatch,
  SelectorReachabilityResult,
} from "../selector-reachability/index.js";
import { getDeclarationLayer } from "./cascadeKeys.js";
import { createConditionSet, mapMatchCertainty } from "./conditions.js";
import { cascadeDeclarationCandidateId } from "./ids.js";
import { compareById } from "./outcomes.js";
import { getCssPropertyEffectsForDeclaration } from "./propertyEffects.js";
import { calculateSelectorSpecificity } from "./specificity.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisDiagnosticCode,
  CascadeConditionSet,
  CascadeDeclarationCandidate,
  CssDeclarationCascadeRecord,
} from "./types.js";

export function buildStylesheetCascadeDeclarations(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  stylesheetOrderById: Map<ProjectEvidenceId, number>;
  diagnostics: CascadeAnalysisDiagnostic[];
  createDiagnostic: (input: {
    code: CascadeAnalysisDiagnosticCode;
    message: string;
    declarationId?: ProjectEvidenceId;
    selectorBranchId?: ProjectEvidenceId;
    elementId?: string;
    location?: CascadeAnalysisDiagnostic["location"];
    traces: CascadeAnalysisDiagnostic["traces"];
  }) => CascadeAnalysisDiagnostic;
}): CssDeclarationCascadeRecord[] {
  return input.projectEvidence.entities.cssDeclarations.map((declaration) => {
    const specificity = calculateSelectorSpecificity(declaration.selectorText);
    if (!specificity.supported) {
      input.diagnostics.push(
        input.createDiagnostic({
          code: "unsupported-selector-specificity",
          message: `Selector specificity could not be calculated for "${declaration.selectorText}".`,
          declarationId: declaration.id,
          location: declaration.location,
          traces: [],
        }),
      );
    }

    const stylesheetSourceOrder = input.stylesheetOrderById.get(declaration.stylesheetId);
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
}

export function buildStylesheetDeclarationCandidates(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  selectorReachability: SelectorReachabilityResult;
  declarations: CssDeclarationCascadeRecord[];
  conditionSetsById: Map<string, CascadeConditionSet>;
  diagnostics: CascadeAnalysisDiagnostic[];
  includeTraces: boolean;
  createDiagnostic: (input: {
    code: CascadeAnalysisDiagnosticCode;
    message: string;
    declarationId?: ProjectEvidenceId;
    selectorBranchId?: ProjectEvidenceId;
    elementId?: string;
    location?: CascadeAnalysisDiagnostic["location"];
    traces: CascadeAnalysisDiagnostic["traces"];
  }) => CascadeAnalysisDiagnostic;
}): CascadeDeclarationCandidate[] {
  const candidates: CascadeDeclarationCandidate[] = [];

  for (const declaration of input.projectEvidence.entities.cssDeclarations) {
    if (!declaration.location) {
      input.diagnostics.push(
        input.createDiagnostic({
          code: "missing-declaration-location",
          message: `Declaration "${declaration.property}" has no source location.`,
          declarationId: declaration.id,
          traces: [],
        }),
      );
    }

    const declarationRecord = input.declarations.find(
      (record) => record.declarationId === declaration.id,
    );
    if (!declarationRecord) {
      continue;
    }

    for (const selectorBranchId of declaration.selectorBranchIds) {
      const selectorBranch =
        input.projectEvidence.indexes.selectorBranchesById.get(selectorBranchId);
      if (!selectorBranch) {
        input.diagnostics.push(
          input.createDiagnostic({
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
        input.diagnostics.push(
          input.createDiagnostic({
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
        input.diagnostics.push(
          input.createDiagnostic({
            code: "missing-selector-branch-match",
            message: `Selector branch "${selectorBranch.selectorText}" has no matched render elements for cascade analysis.`,
            declarationId: declaration.id,
            selectorBranchId,
            location: selectorBranch.location ?? declaration.location,
            traces: input.includeTraces ? selectorBranch.traces : [],
          }),
        );
        continue;
      }

      for (const match of matches) {
        const conditionSet = createConditionSet({
          declaration,
          selectorText: selectorBranch.selectorText,
          match,
          includeTraces: input.includeTraces,
        });
        input.conditionSetsById.set(conditionSet.id, conditionSet);
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
            traces: input.includeTraces ? match.traces : [],
          });
        }
      }
    }
  }

  return candidates;
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
