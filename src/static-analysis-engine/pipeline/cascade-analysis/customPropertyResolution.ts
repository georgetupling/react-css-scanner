import { getCssDeclarationPropertyEffects } from "../../libraries/css-parsing/declarationPropertyEffects.js";
import {
  substituteCssCustomProperties,
  type CssCustomPropertyLookupResult,
} from "../../libraries/css-parsing/customPropertySubstitution.js";
import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
} from "../project-evidence/index.js";
import { cascadeDeclarationCandidateId, elementPropertyKey } from "./ids.js";
import { buildOutcomes, compareById } from "./outcomes.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisDiagnosticCode,
  CascadeConditionSet,
  CascadeDeclarationCandidate,
  CascadeOutcome,
} from "./types.js";

export function resolveCustomPropertyDependentCandidates(input: {
  candidates: CascadeDeclarationCandidate[];
  projectEvidence: ProjectEvidenceAssemblyResult;
  conditionSetsById: Map<string, CascadeConditionSet>;
}): CascadeDeclarationCandidate[] {
  const customPropertyOutcomes = buildOutcomes({
    candidates: input.candidates
      .filter((candidate) => candidate.property.startsWith("--"))
      .sort(compareById),
    projectEvidence: input.projectEvidence,
    conditionSetsById: input.conditionSetsById,
    diagnostics: [],
  });
  const customPropertyOutcomeByElementProperty = new Map(
    customPropertyOutcomes.map((outcome) => [elementPropertyKey(outcome), outcome] as const),
  );
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const candidateGroups = groupCandidatesBySourceDeclaration(input.candidates);
  const replacedCandidateIds = new Set<string>();
  const resolvedCandidates: CascadeDeclarationCandidate[] = [];

  for (const group of candidateGroups) {
    const representative = group[0];
    if (
      !representative ||
      representative.declaredProperty.startsWith("--") ||
      !group.some((candidate) => (candidate.customPropertyDependencies ?? []).length > 0)
    ) {
      continue;
    }

    for (const candidate of group) {
      replacedCandidateIds.add(candidate.id);
    }

    const substitution = substituteCssCustomProperties({
      value: representative.declaredValue,
      resolveCustomProperty: (name) =>
        resolveCustomPropertyForElement({
          name,
          elementId: representative.elementId,
          customPropertyOutcomeByElementProperty,
          candidateById,
          stack: [],
        }),
    });

    if (substitution.status === "unresolved") {
      resolvedCandidates.push(
        ...group.map((candidate) => ({
          ...candidate,
          propertyEffectSupported: false,
          propertyEffectReason: `The "${candidate.declaredProperty}" declaration depends on unresolved custom property substitution: ${substitution.reason}.`,
        })),
      );
      continue;
    }

    const substitutedEffects = getCssDeclarationPropertyEffects({
      property: representative.declaredProperty,
      value: substitution.value,
    });
    for (const effect of substitutedEffects) {
      const candidateBase = { ...representative };
      delete candidateBase.propertyEffectReason;
      delete candidateBase.customPropertyDependencies;
      resolvedCandidates.push({
        ...candidateBase,
        id: cascadeDeclarationCandidateId({
          declarationId: representative.declarationId,
          inlineStyleId: representative.inlineStyleId,
          selectorBranchId: representative.selectorBranchId,
          elementId: representative.elementId,
          property: effect.property,
        }),
        property: effect.property,
        value: effect.value,
        propertyEffectSource: effect.source,
        propertyEffectSupported: effect.supported,
        ...(effect.reason ? { propertyEffectReason: effect.reason } : {}),
        ...(effect.customPropertyDependencies
          ? { customPropertyDependencies: effect.customPropertyDependencies }
          : {}),
        reasons: [
          ...representative.reasons,
          `custom property substitution resolved "${representative.declaredValue}" to "${substitution.value}"`,
          ...(effect.source === "shorthand"
            ? [
                `"${representative.declaredProperty}" contributes to "${effect.property}" after substitution`,
              ]
            : []),
        ],
      });
    }
  }

  return [
    ...input.candidates.filter((candidate) => !replacedCandidateIds.has(candidate.id)),
    ...resolvedCandidates,
  ];
}

export function emitUnsupportedPropertyDiagnostics(input: {
  candidates: CascadeDeclarationCandidate[];
  projectEvidence: ProjectEvidenceAssemblyResult;
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
}): void {
  for (const candidate of input.candidates) {
    if (candidate.propertyEffectSupported) {
      continue;
    }
    const declaration = candidate.declarationId
      ? input.projectEvidence.indexes.cssDeclarationsById.get(candidate.declarationId)
      : undefined;
    input.diagnostics.push(
      input.createDiagnostic({
        code: "unsupported-property-semantics",
        message:
          candidate.propertyEffectReason ??
          `Property semantics are not fully modeled for "${candidate.declaredProperty}".`,
        ...(candidate.declarationId ? { declarationId: candidate.declarationId } : {}),
        ...(candidate.selectorBranchId ? { selectorBranchId: candidate.selectorBranchId } : {}),
        elementId: candidate.elementId,
        location: declaration?.location,
        traces: [],
      }),
    );
  }
}

function groupCandidatesBySourceDeclaration(
  candidates: CascadeDeclarationCandidate[],
): CascadeDeclarationCandidate[][] {
  const groups = new Map<string, CascadeDeclarationCandidate[]>();
  for (const candidate of candidates) {
    const key = [
      candidate.declarationId ?? candidate.inlineStyleId ?? "unknown-source",
      candidate.selectorBranchId ?? "direct",
      candidate.elementId,
      candidate.conditionSetId ?? "none",
      candidate.declaredProperty,
      candidate.declaredValue,
    ].join("::");
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.values()].map((group) => group.sort(compareById));
}

function resolveCustomPropertyForElement(input: {
  name: string;
  elementId: string;
  customPropertyOutcomeByElementProperty: Map<string, CascadeOutcome>;
  candidateById: Map<string, CascadeDeclarationCandidate>;
  stack: string[];
}): CssCustomPropertyLookupResult {
  if (input.stack.includes(input.name)) {
    return {
      status: "unresolved",
      reason: `custom property cycle detected through ${[...input.stack, input.name].join(" -> ")}`,
    };
  }

  const outcome = input.customPropertyOutcomeByElementProperty.get(
    elementPropertyKey({
      elementId: input.elementId,
      property: input.name,
    }),
  );
  if (!outcome) {
    return {
      status: "missing",
    };
  }
  if (
    outcome.certainty !== "definite" ||
    outcome.unresolvedCandidateIds.length > 0 ||
    !outcome.winningCandidateId
  ) {
    return {
      status: "unresolved",
      reason: `custom property ${input.name} does not have a definite cascade winner`,
    };
  }

  const winner = input.candidateById.get(outcome.winningCandidateId);
  if (!winner) {
    return {
      status: "unresolved",
      reason: `custom property ${input.name} winner could not be resolved`,
    };
  }

  return substituteCssCustomProperties({
    value: winner.value,
    resolveCustomProperty: (name) =>
      resolveCustomPropertyForElement({
        ...input,
        name,
        stack: [...input.stack, input.name],
      }),
  });
}
