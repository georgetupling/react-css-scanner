import type { FactNodeId } from "../../fact-graph/index.js";
import { normalizeIdPart } from "../../fact-graph/ids.js";
import type { EvaluatedExpressionId, UnsupportedReasonCode } from "./types.js";

export function canonicalClassExpressionId(siteNodeId: FactNodeId): EvaluatedExpressionId {
  return `canonical-class-expression:${normalizeIdPart(siteNodeId)}`;
}

export function tokenAlternativeId(input: {
  expressionId: EvaluatedExpressionId;
  token: string;
  index: number;
}): EvaluatedExpressionId {
  return `${input.expressionId}:token:${input.index}:${normalizeIdPart(input.token)}`;
}

export function classEmissionVariantId(input: {
  expressionId: EvaluatedExpressionId;
  index: number;
}): EvaluatedExpressionId {
  return `${input.expressionId}:variant:${input.index}`;
}

export function conditionId(input: {
  expressionId: EvaluatedExpressionId;
  conditionKey: string;
}): string {
  return `${input.expressionId}:condition:${normalizeIdPart(input.conditionKey)}`;
}

export function unsupportedReasonId(input: {
  expressionId: EvaluatedExpressionId;
  code: UnsupportedReasonCode;
  index: number;
}): string {
  return `${input.expressionId}:unsupported:${input.index}:${input.code}`;
}

export function externalContributionId(input: {
  expressionId: EvaluatedExpressionId;
  contributionKey: string;
  index: number;
}): string {
  return `${input.expressionId}:external:${input.index}:${normalizeIdPart(input.contributionKey)}`;
}

export function cssModuleContributionId(input: {
  expressionId: EvaluatedExpressionId;
  exportName: string;
  index: number;
}): string {
  return `${input.expressionId}:css-module:${input.index}:${normalizeIdPart(input.exportName)}`;
}
