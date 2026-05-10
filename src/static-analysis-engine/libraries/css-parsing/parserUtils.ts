import type {
  CssAtRuleContextFact,
  CssDeclarationFact,
  CssStyleRuleFact,
} from "../../types/css.js";
import type { SourceAnchor } from "../../types/core.js";
import {
  extractParsedSelectorEntriesFromSelectorPrelude,
  projectToCssSelectorBranchFact,
} from "../selector-parsing/index.js";
import { splitTopLevelSelectorList } from "../selector-parsing/splitTopLevelSelectorList.js";

export const DECLARATION_ONLY_AT_RULES = new Set([
  "font-face",
  "page",
  "counter-style",
  "property",
  "font-palette-values",
]);

export function buildCssStyleRuleFact(input: {
  selectorPrelude: string;
  selectorStartOffset: number;
  sourceText: string;
  filePath?: string;
  declarations: CssDeclarationFact[];
  atRuleContext: CssAtRuleContextFact[];
}): CssStyleRuleFact {
  const selectorEntries = extractParsedSelectorEntriesFromSelectorPrelude({
    selectorPrelude: input.selectorPrelude,
    preludeStartIndex: input.selectorStartOffset,
    sourceText: input.sourceText,
    filePath: input.filePath,
    atRuleContext: input.atRuleContext
      .filter((entry) => entry.name === "media")
      .map((entry) => ({
        kind: "media" as const,
        queryText: entry.params,
      })),
  });

  return {
    selector: input.selectorPrelude,
    selectorEntries,
    selectorBranches: selectorEntries.map((entry) =>
      projectToCssSelectorBranchFact(entry.parsedBranch),
    ),
    declarations: input.declarations,
    line: getLineNumberAtOffset(input.sourceText, input.selectorStartOffset),
    atRuleContext: [...input.atRuleContext],
  };
}

export function expandNestedSelectorPrelude(parentPrelude: string, nestedPrelude: string): string {
  const parentSelectors = splitTopLevelSelectorList(parentPrelude);
  const nestedSelectors = splitTopLevelSelectorList(nestedPrelude);
  const expanded: string[] = [];

  for (const parentSelector of parentSelectors) {
    for (const nestedSelector of nestedSelectors) {
      expanded.push(expandNestedSelector(parentSelector, nestedSelector));
    }
  }

  return expanded.join(", ");
}

export function readPrelude(
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

export function findTopLevelCharacter(
  value: string,
  startIndex: number,
  characters: string,
): number {
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

export function skipIgnorable(content: string, startIndex: number, endIndex: number): number {
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

export function skipComment(content: string, startIndex: number, endIndex: number): number {
  let index = startIndex;

  while (index < endIndex) {
    if (content[index] === "*" && content[index + 1] === "/") {
      return index + 2;
    }

    index += 1;
  }

  return endIndex;
}

export function findBlockEnd(content: string, openBraceIndex: number, endIndex: number): number {
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

export function getLineNumberAtOffset(content: string, offset: number): number {
  let line = 1;

  for (let index = 0; index < offset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
    }
  }

  return line;
}

export function getOffsetForLineAndColumn(input: {
  sourceText: string;
  line: number;
  column: number;
  lineBase: 0 | 1;
  columnBase: 0 | 1;
}): number | undefined {
  const targetLine = input.line - input.lineBase + 1;
  const targetColumn = input.column - input.columnBase + 1;
  let line = 1;
  let column = 1;

  for (let index = 0; index < input.sourceText.length; index += 1) {
    if (line === targetLine && column === targetColumn) {
      return index;
    }

    if (input.sourceText[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return line === targetLine && column === targetColumn ? input.sourceText.length : undefined;
}

export function sourceAnchorFromOffsets(input: {
  sourceText: string;
  filePath?: string;
  startOffset: number;
  endOffset: number;
}): SourceAnchor {
  const start = lineColumnAtOffset(input.sourceText, input.startOffset);
  const end = lineColumnAtOffset(input.sourceText, input.endOffset);
  return {
    filePath: input.filePath ?? "",
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function expandNestedSelector(parentSelector: string, nestedSelector: string): string {
  if (nestedSelector.includes("&")) {
    return nestedSelector.replace(/&/g, parentSelector);
  }

  return `${parentSelector} ${nestedSelector}`;
}

function lineColumnAtOffset(sourceText: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const boundedOffset = Math.max(0, Math.min(offset, sourceText.length));

  for (let index = 0; index < boundedOffset; index += 1) {
    if (sourceText[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}
