import type {
  CssAtRuleContextFact,
  CssDeclarationFact,
  CssStyleRuleFact,
} from "../../types/css.js";
import {
  extractParsedSelectorEntriesFromSelectorPrelude,
  projectToCssSelectorBranchFact,
} from "../selector-parsing/index.js";

const DECLARATION_ONLY_AT_RULES = new Set([
  "font-face",
  "page",
  "counter-style",
  "property",
  "font-palette-values",
]);

export function extractCssStyleRules(input: {
  cssText: string;
  filePath?: string;
}): CssStyleRuleFact[] {
  return parseRuleList(input.cssText, 0, input.cssText.length, [], input.filePath);
}

function parseRuleList(
  content: string,
  startIndex: number,
  endIndex: number,
  atRuleContext: CssAtRuleContextFact[],
  filePath: string | undefined,
): CssStyleRuleFact[] {
  const styleRules: CssStyleRuleFact[] = [];
  let index = startIndex;

  while (index < endIndex) {
    index = skipIgnorable(content, index, endIndex);
    if (index >= endIndex) {
      break;
    }

    const prelude = readPrelude(content, index, endIndex);
    index = prelude.nextIndex;
    const rawPrelude = prelude.value.trim();
    if (!rawPrelude) {
      continue;
    }

    if (prelude.terminator === ";") {
      continue;
    }

    const blockEndIndex = findBlockEnd(content, index - 1, endIndex);
    const blockStartIndex = index;
    const blockBody = content.slice(blockStartIndex, blockEndIndex);

    if (rawPrelude.startsWith("@")) {
      const atRule = parseAtRulePrelude(rawPrelude);
      if (!DECLARATION_ONLY_AT_RULES.has(atRule.name)) {
        styleRules.push(
          ...parseRuleList(
            content,
            blockStartIndex,
            blockEndIndex,
            [...atRuleContext, atRule],
            filePath,
          ),
        );
      }
    } else {
      const selectorBranches = extractParsedSelectorEntriesFromSelectorPrelude({
        selectorPrelude: rawPrelude,
        preludeStartIndex: prelude.startOffset,
        sourceText: content,
        filePath,
        atRuleContext: atRuleContext
          .filter((entry) => entry.name === "media")
          .map((entry) => ({
            kind: "media" as const,
            queryText: entry.params,
          })),
      }).map((entry) => projectToCssSelectorBranchFact(entry.parsedBranch));
      styleRules.push({
        selector: rawPrelude,
        selectorBranches,
        declarations: extractDeclarations(blockBody),
        line: getLineNumberAtOffset(content, prelude.startOffset),
        atRuleContext: [...atRuleContext],
      });
    }

    index = blockEndIndex + 1;
  }

  return styleRules;
}

function parseAtRulePrelude(prelude: string): CssAtRuleContextFact {
  const normalizedPrelude = prelude.slice(1).trim();
  const firstWhitespaceIndex = normalizedPrelude.search(/\s/);

  if (firstWhitespaceIndex === -1) {
    return {
      name: normalizedPrelude.toLowerCase(),
      params: "",
    };
  }

  return {
    name: normalizedPrelude.slice(0, firstWhitespaceIndex).toLowerCase(),
    params: normalizedPrelude.slice(firstWhitespaceIndex + 1).trim(),
  };
}

function extractDeclarations(blockBody: string): CssDeclarationFact[] {
  const declarations: CssDeclarationFact[] = [];
  let index = 0;

  while (index < blockBody.length) {
    index = skipIgnorable(blockBody, index, blockBody.length);
    if (index >= blockBody.length) {
      break;
    }

    const propertyStartIndex = index;
    const propertySeparatorIndex = findTopLevelCharacter(blockBody, index, ":;");
    if (propertySeparatorIndex === -1) {
      break;
    }

    const separator = blockBody[propertySeparatorIndex];
    if (separator === ";") {
      index = propertySeparatorIndex + 1;
      continue;
    }

    const property = blockBody.slice(propertyStartIndex, propertySeparatorIndex).trim();
    if (!property || (property.startsWith("--") && property.length === 2)) {
      index = propertySeparatorIndex + 1;
      continue;
    }

    const valueStartIndex = propertySeparatorIndex + 1;
    const valueEndIndex = findTopLevelCharacter(blockBody, valueStartIndex, ";");
    const declarationEndIndex = valueEndIndex === -1 ? blockBody.length : valueEndIndex;
    const value = blockBody.slice(valueStartIndex, declarationEndIndex).trim();

    if (property && value) {
      declarations.push({
        property,
        value,
      });
    }

    index = declarationEndIndex + 1;
  }

  return declarations;
}

function readPrelude(
  content: string,
  startIndex: number,
  endIndex: number,
): { value: string; nextIndex: number; terminator: "{" | ";"; startOffset: number } {
  let index = startIndex;
  let bracketDepth = 0;
  let parenDepth = 0;
  let stringQuote: string | undefined;
  let escaped = false;

  while (index < endIndex) {
    const character = content[index];

    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (stringQuote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = undefined;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      index += 1;
      continue;
    }

    if (character === "/" && content[index + 1] === "*") {
      index = skipComment(content, index + 2, endIndex);
      continue;
    }

    if (character === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      index += 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      index += 1;
      continue;
    }

    if (bracketDepth === 0 && parenDepth === 0 && (character === "{" || character === ";")) {
      return {
        value: content.slice(startIndex, index),
        nextIndex: index + 1,
        terminator: character,
        startOffset: startIndex,
      };
    }

    index += 1;
  }

  return {
    value: content.slice(startIndex, endIndex),
    nextIndex: endIndex,
    terminator: ";",
    startOffset: startIndex,
  };
}

function findBlockEnd(content: string, openBraceIndex: number, endIndex: number): number {
  let index = openBraceIndex + 1;
  let depth = 1;
  let stringQuote: string | undefined;
  let escaped = false;

  while (index < endIndex) {
    const character = content[index];

    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (stringQuote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = undefined;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      index += 1;
      continue;
    }

    if (character === "/" && content[index + 1] === "*") {
      index = skipComment(content, index + 2, endIndex);
      continue;
    }

    if (character === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return endIndex;
}

function findTopLevelCharacter(value: string, startIndex: number, characters: string): number {
  let index = startIndex;
  let bracketDepth = 0;
  let parenDepth = 0;
  let stringQuote: string | undefined;
  let escaped = false;

  while (index < value.length) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (stringQuote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = undefined;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      index += 1;
      continue;
    }

    if (character === "/" && value[index + 1] === "*") {
      index = skipComment(value, index + 2, value.length);
      continue;
    }

    if (character === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      index += 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      index += 1;
      continue;
    }

    if (bracketDepth === 0 && parenDepth === 0 && characters.includes(character)) {
      return index;
    }

    index += 1;
  }

  return -1;
}

function skipIgnorable(content: string, startIndex: number, endIndex: number): number {
  let index = startIndex;

  while (index < endIndex) {
    if (/\s/.test(content[index])) {
      index += 1;
      continue;
    }

    if (content[index] === "/" && content[index + 1] === "*") {
      index = skipComment(content, index + 2, endIndex);
      continue;
    }

    break;
  }

  return index;
}

function skipComment(content: string, startIndex: number, endIndex: number): number {
  let index = startIndex;

  while (index < endIndex) {
    if (content[index] === "*" && content[index + 1] === "/") {
      return index + 2;
    }

    index += 1;
  }

  return endIndex;
}

function getLineNumberAtOffset(content: string, offset: number): number {
  let line = 1;

  for (let index = 0; index < offset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
    }
  }

  return line;
}
