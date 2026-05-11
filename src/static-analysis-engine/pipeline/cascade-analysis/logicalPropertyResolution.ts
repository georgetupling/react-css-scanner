import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import { buildOutcomes } from "./outcomes.js";
import { elementPropertyKey } from "./ids.js";
import { compareById } from "./candidateComparison.js";
import type { CascadeConditionSet, CascadeDeclarationCandidate, CascadeOutcome } from "./types.js";

type PhysicalFlow = {
  blockStart: "top" | "right" | "bottom" | "left";
  blockEnd: "top" | "right" | "bottom" | "left";
  inlineStart: "top" | "right" | "bottom" | "left";
  inlineEnd: "top" | "right" | "bottom" | "left";
};

export function resolveLogicalPropertyCandidates(input: {
  candidates: CascadeDeclarationCandidate[];
  projectEvidence: ProjectEvidenceAssemblyResult;
  conditionSetsById: Map<string, CascadeConditionSet>;
}): CascadeDeclarationCandidate[] {
  const styleOutcomes = buildOutcomes({
    candidates: input.candidates
      .filter(
        (candidate) => candidate.property === "writing-mode" || candidate.property === "direction",
      )
      .sort(compareById),
    projectEvidence: input.projectEvidence,
    conditionSetsById: input.conditionSetsById,
    diagnostics: [],
  });
  const outcomeByElementProperty = new Map(
    styleOutcomes.map((outcome) => [elementPropertyKey(outcome), outcome] as const),
  );
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));

  return input.candidates.map((candidate) => {
    const logicalMapping = getLogicalPropertyMapping(candidate.property);
    if (!logicalMapping) {
      return candidate;
    }

    const flow = resolvePhysicalFlow({
      elementId: candidate.elementId,
      outcomeByElementProperty,
      candidateById,
    });
    if (!flow) {
      return candidate;
    }

    const physicalProperty = logicalMapping(flow);
    if (!physicalProperty || physicalProperty === candidate.property) {
      return candidate;
    }

    return {
      ...candidate,
      id: `${candidate.id}:logical:${physicalProperty}`,
      property: physicalProperty,
      reasons: [
        ...candidate.reasons,
        `"${candidate.property}" maps to "${physicalProperty}" for the element's definite writing mode and direction`,
      ],
    };
  });
}

function resolvePhysicalFlow(input: {
  elementId: string;
  outcomeByElementProperty: Map<string, CascadeOutcome>;
  candidateById: Map<string, CascadeDeclarationCandidate>;
}): PhysicalFlow | undefined {
  const writingMode = getDefiniteOutcomeValueOrInitial({
    elementId: input.elementId,
    property: "writing-mode",
    initialValue: "horizontal-tb",
    outcomeByElementProperty: input.outcomeByElementProperty,
    candidateById: input.candidateById,
  });
  const direction = getDefiniteOutcomeValueOrInitial({
    elementId: input.elementId,
    property: "direction",
    initialValue: "ltr",
    outcomeByElementProperty: input.outcomeByElementProperty,
    candidateById: input.candidateById,
  });
  if (!writingMode || !direction) {
    return undefined;
  }

  if (direction !== "ltr" && direction !== "rtl") {
    return undefined;
  }

  if (writingMode === "horizontal-tb") {
    return {
      blockStart: "top",
      blockEnd: "bottom",
      inlineStart: direction === "ltr" ? "left" : "right",
      inlineEnd: direction === "ltr" ? "right" : "left",
    };
  }

  if (writingMode === "vertical-rl") {
    return {
      blockStart: "right",
      blockEnd: "left",
      inlineStart: direction === "ltr" ? "top" : "bottom",
      inlineEnd: direction === "ltr" ? "bottom" : "top",
    };
  }

  if (writingMode === "vertical-lr") {
    return {
      blockStart: "left",
      blockEnd: "right",
      inlineStart: direction === "ltr" ? "top" : "bottom",
      inlineEnd: direction === "ltr" ? "bottom" : "top",
    };
  }

  return undefined;
}

function getDefiniteOutcomeValueOrInitial(input: {
  elementId: string;
  property: string;
  initialValue: string;
  outcomeByElementProperty: Map<string, CascadeOutcome>;
  candidateById: Map<string, CascadeDeclarationCandidate>;
}): string | undefined {
  const outcome = input.outcomeByElementProperty.get(
    elementPropertyKey({
      elementId: input.elementId,
      property: input.property,
    }),
  );
  if (!outcome) {
    return input.initialValue;
  }
  if (
    outcome.certainty !== "definite" ||
    outcome.unresolvedCandidateIds.length > 0 ||
    !outcome.winningCandidateId
  ) {
    return undefined;
  }
  return input.candidateById.get(outcome.winningCandidateId)?.value.trim().toLowerCase();
}

function getLogicalPropertyMapping(
  property: string,
): ((flow: PhysicalFlow) => string | undefined) | undefined {
  const normalized = property.trim().toLowerCase();
  const box = /^(margin|padding)-(block|inline)-(start|end)$/u.exec(normalized);
  if (box) {
    const [, prefix, axis, side] = box;
    return (flow) => {
      const physicalSide = flowSide(flow, axis, side);
      return physicalSide ? `${prefix}-${physicalSide}` : undefined;
    };
  }

  const inset = /^inset-(block|inline)-(start|end)$/u.exec(normalized);
  if (inset) {
    const [, axis, side] = inset;
    return (flow) => flowSide(flow, axis, side);
  }

  const border = /^border-(block|inline)-(start|end)-(width|style|color)$/u.exec(normalized);
  if (border) {
    const [, axis, side, part] = border;
    return (flow) => {
      const physicalSide = flowSide(flow, axis, side);
      return physicalSide ? `border-${physicalSide}-${part}` : undefined;
    };
  }

  return undefined;
}

function flowSide(
  flow: PhysicalFlow,
  axis: string | undefined,
  side: string | undefined,
): "top" | "right" | "bottom" | "left" | undefined {
  if (axis === "block" && side === "start") {
    return flow.blockStart;
  }
  if (axis === "block" && side === "end") {
    return flow.blockEnd;
  }
  if (axis === "inline" && side === "start") {
    return flow.inlineStart;
  }
  if (axis === "inline" && side === "end") {
    return flow.inlineEnd;
  }
  return undefined;
}
