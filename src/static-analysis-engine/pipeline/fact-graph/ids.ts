import type { FactEdgeId, FactNodeId } from "./types.js";

export function fileResourceNodeId(filePath: string): FactNodeId {
  return `file:${normalizeIdPart(filePath)}`;
}

export function moduleNodeId(filePath: string): FactNodeId {
  return `module:${normalizeIdPart(filePath)}`;
}

export function stylesheetNodeId(filePath: string): FactNodeId {
  return `stylesheet:${normalizeIdPart(filePath)}`;
}

export function ruleDefinitionNodeId(stylesheetId: FactNodeId, ruleIndex: number): FactNodeId {
  return `rule:${stylesheetId}:${ruleIndex}`;
}

export function selectorNodeId(stylesheetId: FactNodeId, ruleIndex: number): FactNodeId {
  return `selector:${stylesheetId}:${ruleIndex}`;
}

export function selectorBranchNodeId(
  stylesheetId: FactNodeId,
  ruleIndex: number,
  branchIndex: number,
): FactNodeId {
  return `selector-branch:${stylesheetId}:${ruleIndex}:${branchIndex}`;
}

export function originatesFromFileEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `originates-from-file:${from}->${to}`;
}

export function containsEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `contains:${from}->${to}`;
}

export function definesSelectorEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `defines-selector:${from}->${to}`;
}

export function normalizeIdPart(value: string): string {
  return value.replace(/\\/g, "/");
}
