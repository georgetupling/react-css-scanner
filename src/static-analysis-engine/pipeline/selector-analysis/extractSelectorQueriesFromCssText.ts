import type { CssAtRuleContext, ExtractedSelectorQuery, SelectorSourceInput } from "./types.js";

export function extractSelectorQueriesFromCssText(
  input: SelectorSourceInput,
): ExtractedSelectorQuery[] {
  const cssWithoutComments = input.cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const queries: ExtractedSelectorQuery[] = [];

  collectSelectorQueries({
    sourceText: cssWithoutComments,
    filePath: input.filePath,
    blockStart: 0,
    blockEnd: cssWithoutComments.length,
    inheritedAtRuleContext: [],
    queries,
  });

  return queries;
}

function collectSelectorQueries(input: {
  sourceText: string;
  filePath: string | undefined;
  blockStart: number;
  blockEnd: number;
  inheritedAtRuleContext: CssAtRuleContext[];
  queries: ExtractedSelectorQuery[];
}) {
  const { sourceText, blockStart, blockEnd, inheritedAtRuleContext, queries, filePath } = input;
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
      collectSelectorQueries({
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
        queries,
      });
    } else if (!preludeText.startsWith("@")) {
      for (const selectorEntry of splitSelectorPrelude(
        sourceText.slice(preludeStartIndex, openBraceIndex),
        preludeStartIndex,
      )) {
        queries.push({
          selectorText: selectorEntry.selectorText,
          source: {
            kind: "css-source",
            selectorAnchor: toSourceAnchor(
              sourceText,
              filePath,
              selectorEntry.startOffset,
              selectorEntry.endOffset,
            ),
            ...(inheritedAtRuleContext.length > 0
              ? {
                  atRuleContext: inheritedAtRuleContext,
                }
              : {}),
          },
        });
      }
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

function splitSelectorPrelude(
  selectorPrelude: string,
  preludeStartIndex: number,
): Array<{
  selectorText: string;
  startOffset: number;
  endOffset: number;
}> {
  const entries: Array<{
    selectorText: string;
    startOffset: number;
    endOffset: number;
  }> = [];
  let cursor = 0;

  for (const rawPart of selectorPrelude.split(",")) {
    const rawPartStart = cursor;
    const rawPartEnd = rawPartStart + rawPart.length;
    const trimmed = rawPart.trim();

    if (trimmed) {
      const leadingWhitespace = rawPart.match(/^\s*/)?.[0].length ?? 0;
      const trailingWhitespace = rawPart.match(/\s*$/)?.[0].length ?? 0;
      const startOffset = preludeStartIndex + rawPartStart + leadingWhitespace;
      const endOffset = preludeStartIndex + rawPartEnd - trailingWhitespace;

      entries.push({
        selectorText: trimmed,
        startOffset,
        endOffset,
      });
    }

    cursor = rawPartEnd + 1;
  }

  return entries;
}

function toSourceAnchor(
  sourceText: string,
  filePath: string | undefined,
  startOffset: number,
  endOffset: number,
) {
  if (!filePath) {
    return undefined;
  }

  const start = toLineAndColumn(sourceText, startOffset);
  const end = toLineAndColumn(sourceText, endOffset);

  return {
    filePath,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function toLineAndColumn(sourceText: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (sourceText[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { line, column };
}
