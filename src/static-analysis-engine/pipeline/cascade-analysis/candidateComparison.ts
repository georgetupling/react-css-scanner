import { compareSpecificity } from "./specificity.js";
import type { CascadeComparisonReason, CascadeDeclarationCandidate } from "./types.js";

export function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

export function compareCandidates(
  left: CascadeDeclarationCandidate,
  right: CascadeDeclarationCandidate,
): number {
  return (
    Number(left.cascadeKey.important) - Number(right.cascadeKey.important) ||
    originPrecedenceRank(left) - originPrecedenceRank(right) ||
    compareLayerPrecedence(left, right) ||
    compareSpecificity(left.cascadeKey.specificity, right.cascadeKey.specificity) ||
    compareScopeProximity(left, right) ||
    (left.cascadeKey.sourceOrder ?? 0) - (right.cascadeKey.sourceOrder ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

export function compareCandidatesReason(
  winner: CascadeDeclarationCandidate,
  loser: CascadeDeclarationCandidate,
): CascadeComparisonReason {
  if (winner.cascadeKey.important !== loser.cascadeKey.important) {
    return "important";
  }
  if (originPrecedenceRank(winner) !== originPrecedenceRank(loser)) {
    return "higher-origin";
  }
  if (compareLayerPrecedence(winner, loser) !== 0) {
    return "layer-order";
  }
  if (compareSpecificity(winner.cascadeKey.specificity, loser.cascadeKey.specificity) !== 0) {
    return "specificity";
  }
  if (compareScopeProximity(winner, loser) !== 0) {
    return "scope-proximity";
  }
  return "source-order";
}

function originPrecedenceRank(candidate: CascadeDeclarationCandidate): number {
  switch (candidate.cascadeKey.origin) {
    case "user-agent":
      return 0;
    case "user":
      return 1;
    case "author":
      return 2;
    case "inline":
      return 3;
    default:
      return -1;
  }
}

function compareLayerPrecedence(
  left: CascadeDeclarationCandidate,
  right: CascadeDeclarationCandidate,
): number {
  return layerPrecedenceRank(left) - layerPrecedenceRank(right);
}

function layerPrecedenceRank(candidate: CascadeDeclarationCandidate): number {
  const layer = candidate.cascadeKey.layer;
  if (!layer || layer.unlayered) {
    return candidate.cascadeKey.important ? -1_000_000 : 1_000_000;
  }
  const layerOrder = layer.order ?? 0;
  return candidate.cascadeKey.important ? -layerOrder : layerOrder;
}

function compareScopeProximity(
  left: CascadeDeclarationCandidate,
  right: CascadeDeclarationCandidate,
): number {
  const leftDistance = scopeDistanceRank(left);
  const rightDistance = scopeDistanceRank(right);
  if (leftDistance === rightDistance) {
    return 0;
  }
  return rightDistance - leftDistance;
}

function scopeDistanceRank(candidate: CascadeDeclarationCandidate): number {
  const scopeProximity = candidate.cascadeKey.scopeProximity;
  if (!scopeProximity?.known || scopeProximity.distance === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return scopeProximity.distance;
}
