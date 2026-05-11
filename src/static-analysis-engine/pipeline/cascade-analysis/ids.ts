import type { CascadeConditionSet } from "./types.js";

export function cascadeDeclarationCandidateId(input: {
  declarationId?: string;
  inlineStyleId?: string;
  selectorBranchId?: string;
  elementId: string;
  runtimeContextId?: string;
  property: string;
}): string {
  const parts = [
    "cascade-candidate",
    input.declarationId ?? input.inlineStyleId ?? "unknown-source",
    input.selectorBranchId ?? "direct",
    input.elementId,
  ];
  if (input.runtimeContextId) {
    parts.push(input.runtimeContextId);
  }
  parts.push(input.property);
  return parts.join(":");
}

export function cascadeOutcomeId(input: { elementId: string; property: string }): string {
  return ["cascade-outcome", input.elementId, input.property].join(":");
}

export function cascadeDiagnosticId(input: {
  code: string;
  declarationId?: string;
  selectorBranchId?: string;
  elementId?: string;
  index: number;
}): string {
  return [
    "cascade-diagnostic",
    input.code,
    input.declarationId ?? "none",
    input.selectorBranchId ?? "none",
    input.elementId ?? "none",
    input.index,
  ].join(":");
}

export function cascadeConditionSetId(input: Omit<CascadeConditionSet, "id">): string {
  return [
    "cascade-condition",
    input.sources.join(",") || "none",
    input.atRuleContext.map((entry) => `${entry.name}:${entry.params}`).join("|") || "none",
    input.renderConditionIds.join(",") || "none",
    input.classEmissionConditionIds.join(",") || "none",
    input.pseudoStates.join(",") || "none",
    input.runtimeContextIds.join(",") || "none",
  ].join(":");
}

export function elementPropertyKey(input: { elementId: string; property: string }): string {
  return `${input.elementId}::${input.property}`;
}
