import {
  readCssIdentifier,
  readParenthesizedContent,
  skipBalancedSection,
  skipTypeOrNamespaceToken,
} from "./readCssIdentifier.js";
import { splitTopLevelSelectorList } from "./splitTopLevelSelectorList.js";
import type {
  ParsedClassAttributePredicate,
  ParsedHasClassRelation,
  ParsedSimpleSelectorSequence,
} from "./types.js";

export function parseSimpleSelectorSequence(segment: string): ParsedSimpleSelectorSequence {
  const requiredClasses: string[] = [];
  const classAttributePredicates: ParsedClassAttributePredicate[] = [];
  const negativeClasses: string[] = [];
  const hasDescendantClasses: string[] = [];
  const hasClassRelations: ParsedHasClassRelation[] = [];
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
        if (attributeToken.operator === "token") {
          requiredClasses.push(attributeToken.value);
        } else {
          classAttributePredicates.push({
            operator: attributeToken.operator,
            value: attributeToken.value,
          });
          hasSubjectModifiers = true;
        }
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
        const parsedHasRelations = parseHasClassRelations(inner.content);
        if (parsedHasRelations) {
          hasClassRelations.push(...parsedHasRelations);
          hasDescendantClasses.push(
            ...parsedHasRelations
              .filter((relation) => relation.relation === "descendant")
              .map((relation) => relation.className),
          );
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
    classAttributePredicates: uniqueClassAttributePredicates(classAttributePredicates),
    negativeClasses: unique(negativeClasses),
    hasDescendantClasses: unique(hasDescendantClasses),
    hasClassRelations: uniqueHasClassRelations(hasClassRelations),
    hasUnknownSemantics,
    hasSubjectModifiers,
    hasTypeOrIdConstraint,
  };
}

function readAttributeClassToken(
  segment: string,
  startIndex: number,
):
  | {
      operator: "token" | "prefix" | "suffix" | "substring";
      value: string;
      nextIndex: number;
    }
  | undefined {
  const endIndex = skipBalancedSection(segment, startIndex, "[", "]");
  const rawAttribute = segment.slice(startIndex + 1, Math.max(startIndex + 1, endIndex - 1)).trim();
  const match = /^class\s*(~=|\^=|\$=|\*=)\s*(["'])(.*?)\2$/u.exec(rawAttribute);
  if (!match?.[3]) {
    return undefined;
  }

  const operator =
    match[1] === "~="
      ? "token"
      : match[1] === "^="
        ? "prefix"
        : match[1] === "$="
          ? "suffix"
          : "substring";
  return {
    operator,
    value: match[3],
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

function parseHasClassRelations(value: string): ParsedHasClassRelation[] | undefined {
  const selectors = splitTopLevelSelectorList(value);
  if (selectors.length === 0) {
    return undefined;
  }

  const relations: ParsedHasClassRelation[] = [];
  for (const selector of selectors) {
    let trimmed = selector.trim();
    let relation: ParsedHasClassRelation["relation"] = "descendant";
    const firstCharacter = trimmed[0];
    if (firstCharacter === ">" || firstCharacter === "+" || firstCharacter === "~") {
      relation =
        firstCharacter === ">"
          ? "child"
          : firstCharacter === "+"
            ? "adjacent-sibling"
            : "general-sibling";
      trimmed = trimmed.slice(1).trim();
    }

    const unwrappedClassNames = unwrapClassSelectorListPseudo(trimmed);
    if (unwrappedClassNames) {
      relations.push(
        ...unwrappedClassNames.map((className) => ({
          relation,
          className,
        })),
      );
      continue;
    }

    if (!trimmed.startsWith(".")) {
      return undefined;
    }

    const identifier = readCssIdentifier(trimmed, 1);
    if (!identifier || identifier.nextIndex !== trimmed.length) {
      return undefined;
    }

    relations.push({ relation, className: identifier.value });
  }

  return relations;
}

function unwrapClassSelectorListPseudo(selector: string): string[] | undefined {
  const match = /^:(is|where)\(/iu.exec(selector);
  if (!match) {
    return undefined;
  }

  const inner = readParenthesizedContent(selector, match[0].length - 1);
  if (inner.nextIndex !== selector.length) {
    return undefined;
  }

  return parseRequiredClassNames(inner.content);
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

function uniqueClassAttributePredicates(
  predicates: ParsedClassAttributePredicate[],
): ParsedClassAttributePredicate[] {
  return [
    ...new Map(
      predicates.map((predicate) => [`${predicate.operator}:${predicate.value}`, predicate]),
    ).values(),
  ];
}

function uniqueHasClassRelations(relations: ParsedHasClassRelation[]): ParsedHasClassRelation[] {
  return [
    ...new Map(
      relations.map((relation) => [`${relation.relation}:${relation.className}`, relation]),
    ).values(),
  ];
}

function isIdentifierStart(character: string): boolean {
  return /[_a-zA-Z-]/.test(character);
}
