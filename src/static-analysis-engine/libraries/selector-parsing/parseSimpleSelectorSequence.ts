import {
  readCssIdentifier,
  readParenthesizedContent,
  skipBalancedSection,
  skipTypeOrNamespaceToken,
} from "./readCssIdentifier.js";
import { splitTopLevelSelectorList } from "./splitTopLevelSelectorList.js";
import type { ParsedSimpleSelectorSequence } from "./types.js";

export function parseSimpleSelectorSequence(segment: string): ParsedSimpleSelectorSequence {
  const requiredClasses: string[] = [];
  const negativeClasses: string[] = [];
  const hasDescendantClasses: string[] = [];
  let hasUnknownSemantics = false;
  let hasSubjectModifiers = false;
  let hasTypeOrIdConstraint = false;
  let index = 0;

  while (index < segment.length) {
    const character = segment[index];

    if (character === ".") {
      const identifier = readCssIdentifier(segment, index + 1);
      if (!identifier) {
        hasUnknownSemantics = true;
        index += 1;
        continue;
      }

      requiredClasses.push(identifier.value);
      index = identifier.nextIndex;
      continue;
    }

    if (character === "#") {
      const identifier = readCssIdentifier(segment, index + 1);
      hasSubjectModifiers = true;
      hasTypeOrIdConstraint = true;
      index = identifier?.nextIndex ?? index + 1;
      continue;
    }

    if (character === "[") {
      const attributeToken = readAttributeClassToken(segment, index);
      if (attributeToken) {
        requiredClasses.push(attributeToken.className);
        index = attributeToken.nextIndex;
        continue;
      }

      hasSubjectModifiers = true;
      index = skipBalancedSection(segment, index, "[", "]");
      continue;
    }

    if (character === ":") {
      const isPseudoElement = segment[index + 1] === ":";
      hasSubjectModifiers = true;
      index += isPseudoElement ? 2 : 1;

      const pseudoName = readCssIdentifier(segment, index);
      if (!pseudoName) {
        hasUnknownSemantics = true;
        continue;
      }

      index = pseudoName.nextIndex;
      if (segment[index] !== "(") {
        continue;
      }

      const inner = readParenthesizedContent(segment, index);
      index = inner.nextIndex;

      const normalizedPseudoName = pseudoName.value.toLowerCase();
      if (
        normalizedPseudoName === "is" ||
        normalizedPseudoName === "where" ||
        normalizedPseudoName === "global"
      ) {
        const parsedRequiredClasses = parseRequiredClassNames(inner.content);
        if (parsedRequiredClasses) {
          requiredClasses.push(...parsedRequiredClasses);
          continue;
        }
      }

      if (normalizedPseudoName === "has") {
        const parsedHasClasses = parseRequiredClassNames(inner.content);
        if (parsedHasClasses) {
          hasDescendantClasses.push(...parsedHasClasses);
          continue;
        }
      }

      if (normalizedPseudoName === "not") {
        const parsedNegativeClasses = parseNegatedClassNames(inner.content);
        if (parsedNegativeClasses) {
          negativeClasses.push(...parsedNegativeClasses);
          continue;
        }
      }

      hasUnknownSemantics = true;
      continue;
    }

    if (character === "*" || isIdentifierStart(character) || character === "|") {
      hasSubjectModifiers = true;
      hasTypeOrIdConstraint = true;
      index = skipTypeOrNamespaceToken(segment, index);
      continue;
    }

    if (character === "&") {
      hasUnknownSemantics = true;
      index += 1;
      continue;
    }

    index += 1;
  }

  return {
    requiredClasses: unique(requiredClasses),
    negativeClasses: unique(negativeClasses),
    hasDescendantClasses: unique(hasDescendantClasses),
    hasUnknownSemantics,
    hasSubjectModifiers,
    hasTypeOrIdConstraint,
  };
}

function readAttributeClassToken(
  segment: string,
  startIndex: number,
): { className: string; nextIndex: number } | undefined {
  const endIndex = skipBalancedSection(segment, startIndex, "[", "]");
  const rawAttribute = segment.slice(startIndex + 1, Math.max(startIndex + 1, endIndex - 1)).trim();
  const match = /^class\s*~=\s*(["'])(.*?)\1$/u.exec(rawAttribute);
  if (!match?.[2]) {
    return undefined;
  }

  return {
    className: match[2],
    nextIndex: endIndex,
  };
}

function parseRequiredClassNames(value: string): string[] | undefined {
  const selectors = splitTopLevelSelectorList(value);
  if (selectors.length === 0) {
    return undefined;
  }

  const classNames: string[] = [];
  for (const selector of selectors) {
    const trimmed = selector.trim();
    if (!trimmed.startsWith(".")) {
      return undefined;
    }

    const identifier = readCssIdentifier(trimmed, 1);
    if (!identifier || identifier.nextIndex !== trimmed.length) {
      return undefined;
    }

    classNames.push(identifier.value);
  }

  return classNames;
}

function parseNegatedClassNames(value: string): string[] | undefined {
  const selectors = splitTopLevelSelectorList(value);
  if (selectors.length === 0) {
    return undefined;
  }

  const classNames: string[] = [];
  for (const selector of selectors) {
    const trimmed = selector.trim();
    if (!trimmed.startsWith(".")) {
      return undefined;
    }

    const identifier = readCssIdentifier(trimmed, 1);
    if (!identifier || identifier.nextIndex !== trimmed.length) {
      return undefined;
    }

    classNames.push(identifier.value);
  }

  return classNames;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isIdentifierStart(character: string): boolean {
  return /[_a-zA-Z-]/.test(character);
}
