import {
  getKnownLonghandProperties,
  getLonghandMetadata,
} from "../../libraries/css-parsing/propertyMetadata.js";
import { cascadeComputedPropertyId, elementPropertyKey } from "./ids.js";
import type {
  CascadeComputedProperty,
  CascadeDeclarationCandidate,
  CascadeOutcome,
} from "./types.js";
import type { CascadeAnalysisInput } from "./buildCascadeAnalysis.js";

export function buildComputedProperties(input: {
  analysisInput: CascadeAnalysisInput;
  candidates: CascadeDeclarationCandidate[];
  outcomes: CascadeOutcome[];
}): CascadeComputedProperty[] {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const outcomeByElementProperty = new Map(
    input.outcomes.map((outcome) => [elementPropertyKey(outcome), outcome]),
  );
  const memo = new Map<string, CascadeComputedProperty>();
  const properties = getKnownLonghandProperties();

  for (const element of [...input.analysisInput.renderModel.elements].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    for (const property of properties) {
      resolveComputedProperty({
        elementId: element.id,
        property,
        analysisInput: input.analysisInput,
        candidateById,
        outcomeByElementProperty,
        memo,
        resolving: new Set(),
      });
    }
  }

  return [...memo.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function resolveComputedProperty(input: {
  elementId: string;
  property: string;
  analysisInput: CascadeAnalysisInput;
  candidateById: Map<string, CascadeDeclarationCandidate>;
  outcomeByElementProperty: Map<string, CascadeOutcome>;
  memo: Map<string, CascadeComputedProperty>;
  resolving: Set<string>;
}): CascadeComputedProperty {
  const id = cascadeComputedPropertyId(input);
  const cached = input.memo.get(id);
  if (cached) {
    return cached;
  }

  if (input.resolving.has(id)) {
    return remember(input.memo, {
      id,
      elementId: input.elementId,
      property: input.property,
      source: "unresolved-parent",
      certainty: "unknown",
      reasons: ["Computed property inheritance encountered a cycle in the render parent chain."],
      traces: [],
    });
  }

  input.resolving.add(id);
  const metadata = getLonghandMetadata(input.property);
  const outcome = input.outcomeByElementProperty.get(elementPropertyKey(input));
  if (outcome) {
    const fromOutcome = resolveLocalOutcome({
      ...input,
      id,
      outcome,
      metadata,
    });
    input.resolving.delete(id);
    return remember(input.memo, fromOutcome);
  }

  if (metadata?.inherited) {
    const inherited = resolveInheritedProperty({
      ...input,
      id,
      outcome,
      reason: `No local cascade winner for inherited property "${input.property}".`,
    });
    input.resolving.delete(id);
    return remember(input.memo, inherited);
  }

  input.resolving.delete(id);
  return remember(input.memo, {
    id,
    elementId: input.elementId,
    property: input.property,
    value: metadata?.initialValue,
    source: "initial",
    certainty: metadata ? "definite" : "unknown",
    reasons: metadata
      ? [`No local cascade winner; "${input.property}" resolves to its metadata initial value.`]
      : [`No metadata is available for "${input.property}".`],
    traces: [],
  });
}

function resolveLocalOutcome(input: {
  id: string;
  elementId: string;
  property: string;
  analysisInput: CascadeAnalysisInput;
  candidateById: Map<string, CascadeDeclarationCandidate>;
  outcomeByElementProperty: Map<string, CascadeOutcome>;
  memo: Map<string, CascadeComputedProperty>;
  resolving: Set<string>;
  outcome: CascadeOutcome;
  metadata: ReturnType<typeof getLonghandMetadata>;
}): CascadeComputedProperty {
  if (input.outcome.certainty !== "definite" || !input.outcome.winningCandidateId) {
    return {
      id: input.id,
      elementId: input.elementId,
      property: input.property,
      source: "unresolved-local",
      outcomeId: input.outcome.id,
      certainty: input.outcome.certainty === "unknown" ? "unknown" : "possible",
      reasons: [
        `Local cascade outcome for "${input.property}" is ${input.outcome.certainty}, so computed value is not definite.`,
      ],
      traces: input.outcome.traces,
    };
  }

  const winner = input.candidateById.get(input.outcome.winningCandidateId);
  if (!winner) {
    return {
      id: input.id,
      elementId: input.elementId,
      property: input.property,
      source: "unresolved-local",
      outcomeId: input.outcome.id,
      winningCandidateId: input.outcome.winningCandidateId,
      certainty: "unknown",
      reasons: [`Winning candidate "${input.outcome.winningCandidateId}" is missing.`],
      traces: input.outcome.traces,
    };
  }

  const normalizedValue = winner.value.trim().toLowerCase();
  if (normalizedValue === "initial") {
    return {
      id: input.id,
      elementId: input.elementId,
      property: input.property,
      value: input.metadata?.initialValue,
      source: "initial",
      outcomeId: input.outcome.id,
      winningCandidateId: winner.id,
      certainty: input.metadata ? "definite" : "unknown",
      reasons: [`Winning declaration uses "initial" for "${input.property}".`],
      traces: input.outcome.traces,
    };
  }

  if (normalizedValue === "inherit" || (normalizedValue === "unset" && input.metadata?.inherited)) {
    return resolveInheritedProperty({
      ...input,
      outcome: input.outcome,
      winningCandidateId: winner.id,
      reason:
        normalizedValue === "inherit"
          ? `Winning declaration uses "inherit" for "${input.property}".`
          : `Winning declaration uses inherited "unset" for "${input.property}".`,
    });
  }

  if (normalizedValue === "unset") {
    return {
      id: input.id,
      elementId: input.elementId,
      property: input.property,
      value: input.metadata?.initialValue,
      source: "initial",
      outcomeId: input.outcome.id,
      winningCandidateId: winner.id,
      certainty: input.metadata ? "definite" : "unknown",
      reasons: [`Winning declaration uses non-inherited "unset" for "${input.property}".`],
      traces: input.outcome.traces,
    };
  }

  if (normalizedValue === "revert" || normalizedValue === "revert-layer") {
    return {
      id: input.id,
      elementId: input.elementId,
      property: input.property,
      source: "unsupported-css-wide-keyword",
      outcomeId: input.outcome.id,
      winningCandidateId: winner.id,
      certainty: "unknown",
      reasons: [`CSS-wide keyword "${normalizedValue}" depends on origin/layer context.`],
      traces: input.outcome.traces,
    };
  }

  return {
    id: input.id,
    elementId: input.elementId,
    property: input.property,
    value: winner.value,
    source: "local-cascade",
    outcomeId: input.outcome.id,
    winningCandidateId: winner.id,
    certainty: "definite",
    reasons: [`Winning declaration supplies the computed value for "${input.property}".`],
    traces: input.outcome.traces,
  };
}

function resolveInheritedProperty(input: {
  id: string;
  elementId: string;
  property: string;
  analysisInput: CascadeAnalysisInput;
  candidateById: Map<string, CascadeDeclarationCandidate>;
  outcomeByElementProperty: Map<string, CascadeOutcome>;
  memo: Map<string, CascadeComputedProperty>;
  resolving: Set<string>;
  outcome?: CascadeOutcome;
  winningCandidateId?: string;
  reason: string;
}): CascadeComputedProperty {
  const metadata = getLonghandMetadata(input.property);
  const element = input.analysisInput.renderModel.indexes.elementById.get(input.elementId);
  const parentElementId = element?.parentElementId;

  if (!parentElementId) {
    return {
      id: input.id,
      elementId: input.elementId,
      property: input.property,
      value: metadata?.initialValue,
      source: "initial",
      outcomeId: input.outcome?.id,
      winningCandidateId: input.winningCandidateId,
      certainty: metadata ? "definite" : "unknown",
      reasons: [input.reason, "Element has no modeled parent, so inheritance resolves to initial."],
      traces: input.outcome?.traces ?? [],
    };
  }

  if (!input.analysisInput.renderModel.indexes.elementById.has(parentElementId)) {
    return {
      id: input.id,
      elementId: input.elementId,
      property: input.property,
      source: "unresolved-parent",
      outcomeId: input.outcome?.id,
      winningCandidateId: input.winningCandidateId,
      certainty: "unknown",
      reasons: [input.reason, `Parent element "${parentElementId}" is missing.`],
      traces: input.outcome?.traces ?? [],
    };
  }

  const parent = resolveComputedProperty({
    elementId: parentElementId,
    property: input.property,
    analysisInput: input.analysisInput,
    candidateById: input.candidateById,
    outcomeByElementProperty: input.outcomeByElementProperty,
    memo: input.memo,
    resolving: input.resolving,
  });

  if (!parent.value || parent.certainty === "unknown") {
    return {
      id: input.id,
      elementId: input.elementId,
      property: input.property,
      source: "unresolved-parent",
      outcomeId: input.outcome?.id,
      winningCandidateId: input.winningCandidateId,
      parentComputedPropertyId: parent.id,
      certainty: parent.certainty,
      reasons: [input.reason, `Parent computed value for "${input.property}" is unresolved.`],
      traces: input.outcome?.traces ?? [],
    };
  }

  return {
    id: input.id,
    elementId: input.elementId,
    property: input.property,
    value: parent.value,
    source: "inherited-parent",
    outcomeId: input.outcome?.id,
    winningCandidateId: input.winningCandidateId,
    parentComputedPropertyId: parent.id,
    certainty: parent.certainty,
    reasons: [input.reason, `Inherited value from parent element "${parentElementId}".`],
    traces: input.outcome?.traces ?? [],
  };
}

function remember(
  memo: Map<string, CascadeComputedProperty>,
  property: CascadeComputedProperty,
): CascadeComputedProperty {
  memo.set(property.id, property);
  return property;
}
