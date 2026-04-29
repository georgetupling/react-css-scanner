import type { FactEdge, FactNode } from "../types.js";

export function sortNodes<T extends FactNode>(nodes: T[]): T[] {
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id));
}

export function sortEdges<T extends FactEdge>(edges: T[]): T[] {
  return [...edges].sort((left, right) => left.id.localeCompare(right.id));
}
