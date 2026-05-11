import * as csstree from "css-tree";

import type { CssAtRuleContextFact } from "../../types/css.js";

export type NormalizedAtRuleCondition = {
  applicability: "definite" | "conditional" | "impossible";
  atRuleContext: Array<{ name: string; params: string }>;
  reasons: string[];
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

  return "conditional";
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
