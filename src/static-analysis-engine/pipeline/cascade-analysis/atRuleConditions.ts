import * as csstree from "css-tree";

import type { CssAtRuleContextFact } from "../../types/css.js";

export type NormalizedAtRuleCondition = {
  applicability: "definite" | "conditional" | "impossible";
  atRuleContext: Array<{ name: string; params: string }>;
  reasons: string[];
};

export type MediaWidthRange = {
  minWidthPx?: number;
  minWidthInclusive?: boolean;
  maxWidthPx?: number;
  maxWidthInclusive?: boolean;
};

export type MediaEnvironmentConstraints = {
  width?: MediaWidthRange;
  prefersColorScheme?: "dark" | "light";
  orientation?: "landscape" | "portrait";
};

export type SupportsConditionConstraints = {
  required: string[];
  rejected: string[];
};

export function normalizeAtRuleConditions(
  atRuleContext: CssAtRuleContextFact[],
): NormalizedAtRuleCondition {
  const conditionalContext: Array<{ name: string; params: string }> = [];
  const reasons: string[] = [];

  for (const entry of atRuleContext) {
    if (entry.name === "layer" || entry.name === "scope") {
      continue;
    }

    if (entry.name === "media") {
      const mediaApplicability = evaluateMediaQueryList(entry.params);
      if (mediaApplicability === "impossible") {
        return {
          applicability: "impossible",
          atRuleContext: [],
          reasons: [`@media ${entry.params} can never match a browser environment`],
        };
      }
      if (mediaApplicability === "definite") {
        reasons.push(`@media ${entry.params} is always active`);
        continue;
      }
    }
    if (entry.name === "supports") {
      const supportsApplicability = evaluateSupportsCondition(entry.params);
      if (supportsApplicability === "impossible") {
        return {
          applicability: "impossible",
          atRuleContext: [],
          reasons: [`@supports ${entry.params} can never match supported CSS syntax`],
        };
      }
      if (supportsApplicability === "definite") {
        reasons.push(`@supports ${entry.params} is always active for supported CSS syntax`);
        continue;
      }
    }

    conditionalContext.push({
      name: entry.name,
      params: entry.params,
    });
  }

  return {
    applicability: conditionalContext.length > 0 ? "conditional" : "definite",
    atRuleContext: conditionalContext,
    reasons,
  };
}

function evaluateMediaQueryList(params: string): "definite" | "conditional" | "impossible" {
  const queries = splitMediaQueryList(params);
  if (queries.length === 0) {
    return "conditional";
  }

  let hasConditionalQuery = false;
  for (const query of queries) {
    const applicability = evaluateSingleMediaQuery(query);
    if (applicability === "definite") {
      return "definite";
    }
    if (applicability === "conditional") {
      hasConditionalQuery = true;
    }
  }

  return hasConditionalQuery ? "conditional" : "impossible";
}

function evaluateSingleMediaQuery(query: string): "definite" | "conditional" | "impossible" {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "" || normalized === "all" || normalized === "only all") {
    return normalized === "" ? "conditional" : "definite";
  }

  if (normalized === "not all" || normalized.startsWith("not all and ")) {
    return "impossible";
  }

  const mediaConstraints = getSingleMediaQueryEnvironmentConstraints(normalized);
  if (mediaConstraints && !isMediaEnvironmentConstraintSatisfiable(mediaConstraints)) {
    return "impossible";
  }

  return "conditional";
}

export function getMediaQueryListWidthRange(params: string): MediaWidthRange | undefined {
  return getMediaQueryListEnvironmentConstraints(params)?.width;
}

export function getMediaQueryListEnvironmentConstraints(
  params: string,
): MediaEnvironmentConstraints | undefined {
  const queries = splitMediaQueryList(params);
  if (queries.length !== 1) {
    return undefined;
  }
  return getSingleMediaQueryEnvironmentConstraints(queries[0]);
}

function getSingleMediaQueryEnvironmentConstraints(
  query: string,
): MediaEnvironmentConstraints | undefined {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (
    normalized === "" ||
    normalized.startsWith("not ") ||
    normalized.includes(",") ||
    normalized.includes(" or ")
  ) {
    return undefined;
  }

  const constraints: MediaEnvironmentConstraints = {};
  const width = getSingleMediaQueryWidthRange(normalized);
  if (width) {
    constraints.width = width;
  }

  const colorScheme = getSingleValuedMediaFeature(normalized, "prefers-color-scheme", [
    "dark",
    "light",
  ]);
  if (colorScheme) {
    constraints.prefersColorScheme = colorScheme;
  }

  const orientation = getSingleValuedMediaFeature(normalized, "orientation", [
    "landscape",
    "portrait",
  ]);
  if (orientation) {
    constraints.orientation = orientation;
  }

  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function getSingleMediaQueryWidthRange(query: string): MediaWidthRange | undefined {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  const range: MediaWidthRange = {};
  let sawWidthFeature = false;
  for (const match of normalized.matchAll(
    /\(\s*(min|max)-width\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(px|rem|em)\s*\)/g,
  )) {
    const [, kind, rawValue, unit] = match;
    const valuePx = toPixels(Number(rawValue), unit);
    if (valuePx === undefined) {
      continue;
    }
    sawWidthFeature = true;
    if (kind === "min") {
      applyMinWidth(range, valuePx, true);
    } else {
      applyMaxWidth(range, valuePx, true);
    }
  }

  for (const match of normalized.matchAll(
    /\(\s*width\s*([<>]=?)\s*([0-9]+(?:\.[0-9]+)?)\s*(px|rem|em)\s*\)/g,
  )) {
    const [, operator, rawValue, unit] = match;
    const valuePx = toPixels(Number(rawValue), unit);
    if (valuePx === undefined) {
      continue;
    }
    sawWidthFeature = true;
    if (operator.startsWith(">")) {
      applyMinWidth(range, valuePx, operator === ">=");
    } else {
      applyMaxWidth(range, valuePx, operator === "<=");
    }
  }

  for (const match of normalized.matchAll(
    /\(\s*([0-9]+(?:\.[0-9]+)?)\s*(px|rem|em)\s*([<>]=?)\s*width\s*([<>]=?)\s*([0-9]+(?:\.[0-9]+)?)\s*(px|rem|em)\s*\)/g,
  )) {
    const [, rawLeftValue, leftUnit, leftOperator, rightOperator, rawRightValue, rightUnit] = match;
    const leftValuePx = toPixels(Number(rawLeftValue), leftUnit);
    const rightValuePx = toPixels(Number(rawRightValue), rightUnit);
    if (leftValuePx === undefined || rightValuePx === undefined) {
      continue;
    }
    sawWidthFeature = true;
    if (leftOperator.startsWith("<")) {
      applyMinWidth(range, leftValuePx, leftOperator === "<=");
    } else {
      applyMaxWidth(range, leftValuePx, leftOperator === ">=");
    }
    if (rightOperator.startsWith("<")) {
      applyMaxWidth(range, rightValuePx, rightOperator === "<=");
    } else {
      applyMinWidth(range, rightValuePx, rightOperator === ">=");
    }
  }

  return sawWidthFeature ? range : undefined;
}

function applyMinWidth(range: MediaWidthRange, valuePx: number, inclusive: boolean): void {
  if (
    range.minWidthPx === undefined ||
    valuePx > range.minWidthPx ||
    (valuePx === range.minWidthPx && range.minWidthInclusive === true && !inclusive)
  ) {
    range.minWidthPx = valuePx;
    range.minWidthInclusive = inclusive;
  }
}

function applyMaxWidth(range: MediaWidthRange, valuePx: number, inclusive: boolean): void {
  if (
    range.maxWidthPx === undefined ||
    valuePx < range.maxWidthPx ||
    (valuePx === range.maxWidthPx && range.maxWidthInclusive === true && !inclusive)
  ) {
    range.maxWidthPx = valuePx;
    range.maxWidthInclusive = inclusive;
  }
}

function getSingleValuedMediaFeature<T extends string>(
  query: string,
  featureName: string,
  allowedValues: readonly T[],
): T | undefined {
  let value: T | undefined;
  for (const match of query.matchAll(
    new RegExp(`\\(\\s*${featureName}\\s*:\\s*([A-Za-z-]+)\\s*\\)`, "g"),
  )) {
    const rawValue = match[1] as T | undefined;
    if (!rawValue || !allowedValues.includes(rawValue)) {
      continue;
    }
    if (value && value !== rawValue) {
      return undefined;
    }
    value = rawValue;
  }
  return value;
}

function isMediaEnvironmentConstraintSatisfiable(
  constraints: MediaEnvironmentConstraints,
): boolean {
  const width = constraints.width;
  if (!width || width.minWidthPx === undefined || width.maxWidthPx === undefined) {
    return true;
  }
  if (width.minWidthPx < width.maxWidthPx) {
    return true;
  }
  if (width.minWidthPx > width.maxWidthPx) {
    return false;
  }
  return width.minWidthInclusive === true && width.maxWidthInclusive === true;
}

function toPixels(value: number, unit: string | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  if (unit === "px") {
    return value;
  }
  if (unit === "rem" || unit === "em") {
    return value * 16;
  }
  return undefined;
}

function splitMediaQueryList(params: string): string[] {
  const queries: string[] = [];
  let startIndex = 0;
  let depth = 0;
  let quote: string | undefined;

  for (let index = 0; index < params.length; index += 1) {
    const character = params[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === "," && depth === 0) {
      queries.push(params.slice(startIndex, index).trim());
      startIndex = index + 1;
    }
  }

  const finalQuery = params.slice(startIndex).trim();
  if (finalQuery) {
    queries.push(finalQuery);
  }
  return queries;
}

function evaluateSupportsCondition(params: string): "definite" | "conditional" | "impossible" {
  return evaluateSupportsExpression(params.trim());
}

export function getSupportsConditionConstraints(
  params: string,
): SupportsConditionConstraints | undefined {
  return getSupportsExpressionConstraints(params.trim());
}

function getSupportsExpressionConstraints(
  expression: string,
): SupportsConditionConstraints | undefined {
  const normalized = stripOuterParentheses(expression.trim());
  if (!normalized) {
    return undefined;
  }

  if (splitTopLevelByKeyword(normalized, "or").length > 1) {
    return undefined;
  }

  const andParts = splitTopLevelByKeyword(normalized, "and");
  if (andParts.length > 1) {
    const constraints: SupportsConditionConstraints = { required: [], rejected: [] };
    for (const part of andParts) {
      const partConstraints = getSupportsExpressionConstraints(part);
      if (!partConstraints) {
        return undefined;
      }
      constraints.required.push(...partConstraints.required);
      constraints.rejected.push(...partConstraints.rejected);
    }
    return {
      required: uniqueSortedStrings(constraints.required),
      rejected: uniqueSortedStrings(constraints.rejected),
    };
  }

  const withoutNot = stripLeadingKeyword(normalized, "not");
  if (withoutNot !== normalized) {
    const innerConstraints = getSupportsExpressionConstraints(withoutNot);
    if (
      !innerConstraints ||
      innerConstraints.required.length !== 1 ||
      innerConstraints.rejected.length > 0
    ) {
      return undefined;
    }
    return {
      required: [],
      rejected: innerConstraints.required,
    };
  }

  const declaration = parseSupportsDeclaration(normalized);
  if (!declaration || !isCssDeclarationSyntaxSupported(declaration)) {
    return undefined;
  }
  return {
    required: [supportsDeclarationKey(declaration)],
    rejected: [],
  };
}

function evaluateSupportsExpression(expression: string): "definite" | "conditional" | "impossible" {
  const normalized = stripOuterParentheses(expression.trim());
  if (!normalized) {
    return "conditional";
  }

  const orParts = splitTopLevelByKeyword(normalized, "or");
  if (orParts.length > 1) {
    let hasConditionalPart = false;
    for (const part of orParts) {
      const applicability = evaluateSupportsExpression(part);
      if (applicability === "definite") {
        return "definite";
      }
      if (applicability === "conditional") {
        hasConditionalPart = true;
      }
    }
    return hasConditionalPart ? "conditional" : "impossible";
  }

  const andParts = splitTopLevelByKeyword(normalized, "and");
  if (andParts.length > 1) {
    let hasConditionalPart = false;
    for (const part of andParts) {
      const applicability = evaluateSupportsExpression(part);
      if (applicability === "impossible") {
        return "impossible";
      }
      if (applicability === "conditional") {
        hasConditionalPart = true;
      }
    }
    return hasConditionalPart ? "conditional" : "definite";
  }

  const withoutNot = stripLeadingKeyword(normalized, "not");
  if (withoutNot !== normalized) {
    return invertApplicability(evaluateSupportsExpression(withoutNot));
  }

  return evaluateSupportsLeaf(normalized);
}

function evaluateSupportsLeaf(expression: string): "definite" | "conditional" | "impossible" {
  const declaration = parseSupportsDeclaration(expression);
  if (!declaration) {
    return "conditional";
  }

  if (declaration.property.startsWith("--")) {
    return declaration.value.trim().length > 0 ? "definite" : "impossible";
  }

  if (!isCssDeclarationSyntaxSupported(declaration)) {
    return "impossible";
  }
  return "conditional";
}

function parseSupportsDeclaration(input: string): { property: string; value: string } | undefined {
  const expression = stripOuterParentheses(input.trim());
  const colonIndex = findTopLevelCharacter(expression, ":");
  if (colonIndex <= 0) {
    return undefined;
  }

  const property = expression.slice(0, colonIndex).trim().toLowerCase();
  const value = expression.slice(colonIndex + 1).trim();
  if (
    !/^(?:--[A-Za-z_][A-Za-z0-9_-]*|-?[A-Za-z_][A-Za-z0-9_-]*)$/.test(property) ||
    value.length === 0
  ) {
    return undefined;
  }

  return { property, value };
}

function supportsDeclarationKey(input: { property: string; value: string }): string {
  return `${input.property}:${input.value.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function isCssDeclarationSyntaxSupported(input: { property: string; value: string }): boolean {
  try {
    const ast = csstree.parse(input.value, { context: "value" }) as csstree.CssNode;
    return csstree.lexer.matchProperty(input.property, ast).error === null;
  } catch {
    return false;
  }
}

function invertApplicability(
  applicability: "definite" | "conditional" | "impossible",
): "definite" | "conditional" | "impossible" {
  if (applicability === "definite") {
    return "impossible";
  }
  if (applicability === "impossible") {
    return "definite";
  }
  return "conditional";
}

function stripOuterParentheses(input: string): string {
  let output = input.trim();
  while (output.startsWith("(") && output.endsWith(")") && wrapsEntireExpression(output)) {
    output = output.slice(1, -1).trim();
  }
  return output;
}

function wrapsEntireExpression(input: string): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
    }
    if (character === ")") {
      depth -= 1;
      if (depth === 0 && index < input.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

function splitTopLevelByKeyword(input: string, keyword: "and" | "or"): string[] {
  const parts: string[] = [];
  let startIndex = 0;
  let depth = 0;
  let quote: string | undefined;
  const lowerInput = input.toLowerCase();

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && keywordAt(lowerInput, index, keyword)) {
      parts.push(input.slice(startIndex, index).trim());
      startIndex = index + keyword.length;
      index = startIndex - 1;
    }
  }

  if (parts.length === 0) {
    return [input];
  }
  parts.push(input.slice(startIndex).trim());
  return parts.filter((part) => part.length > 0);
}

function stripLeadingKeyword(input: string, keyword: string): string {
  const normalized = input.trim();
  return keywordAt(normalized.toLowerCase(), 0, keyword)
    ? normalized.slice(keyword.length).trim()
    : normalized;
}

function keywordAt(input: string, index: number, keyword: string): boolean {
  if (input.slice(index, index + keyword.length) !== keyword) {
    return false;
  }
  return (
    !isIdentifierCharacter(input[index - 1]) &&
    !isIdentifierCharacter(input[index + keyword.length])
  );
}

function findTopLevelCharacter(input: string, target: string): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === target && depth === 0) {
      return index;
    }
  }
  return -1;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_-]/.test(character);
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
