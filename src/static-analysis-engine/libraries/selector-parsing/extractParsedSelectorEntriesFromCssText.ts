import { extractParsedSelectorEntriesFromSelectorPrelude } from "./extractParsedSelectorEntriesFromSelectorPrelude.js";
import type { ParsedCssAtRuleContext, ParsedCssSelectorEntry } from "./types.js";

export function extractParsedSelectorEntriesFromCssText(input: {
  cssText: string;
  filePath?: string;
}): ParsedCssSelectorEntry[] {
  const cssWithoutComments = input.cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const entries: ParsedCssSelectorEntry[] = [];

  collectSelectorEntries({
    sourceText: cssWithoutComments,
    filePath: input.filePath,
    blockStart: 0,
    blockEnd: cssWithoutComments.length,
    inheritedAtRuleContext: [],
    entries,
  });

  return entries;
}

function collectSelectorEntries(input: {
  sourceText: string;
  filePath: string | undefined;
  blockStart: number;
  blockEnd: number;
  inheritedAtRuleContext: ParsedCssAtRuleContext[];
  entries: ParsedCssSelectorEntry[];
}) {
  const { sourceText, blockStart, blockEnd, inheritedAtRuleContext, entries, filePath } = input;
  let cursor = blockStart;

  while (cursor < blockEnd) {
    cursor = skipWhitespace(sourceText, cursor, blockEnd);
    if (cursor >= blockEnd) {
      return;
    }

    const openBraceIndex = sourceText.indexOf("{", cursor);
    if (openBraceIndex === -1 || openBraceIndex >= blockEnd) {
      return;
    }

    const preludeText = sourceText.slice(cursor, openBraceIndex).trim();
    const preludeStartIndex = cursor;
    const blockCloseIndex = findMatchingBrace(sourceText, openBraceIndex, blockEnd);
    if (blockCloseIndex === -1) {
      return;
    }

    if (preludeText.startsWith("@media")) {
      const queryText = preludeText.slice("@media".length).trim();
      collectSelectorEntries({
        sourceText,
        filePath,
        blockStart: openBraceIndex + 1,
        blockEnd: blockCloseIndex,
        inheritedAtRuleContext: [
          ...inheritedAtRuleContext,
          {
            kind: "media",
            queryText,
          },
        ],
        entries,
      });
    } else if (!preludeText.startsWith("@")) {
      entries.push(
        ...extractParsedSelectorEntriesFromSelectorPrelude({
          selectorPrelude: sourceText.slice(preludeStartIndex, openBraceIndex),
          preludeStartIndex,
          sourceText,
          filePath,
          atRuleContext: inheritedAtRuleContext,
        }),
      );
    }

    cursor = blockCloseIndex + 1;
  }
}

function skipWhitespace(sourceText: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end && /\s/.test(sourceText[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function findMatchingBrace(sourceText: string, openBraceIndex: number, end: number): number {
  let depth = 0;

  for (let index = openBraceIndex; index < end; index += 1) {
    if (sourceText[index] === "{") {
      depth += 1;
      continue;
    }

    if (sourceText[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}
