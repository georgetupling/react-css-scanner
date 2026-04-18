import type { ExtractedSelectorQuery, SelectorSourceInput } from "./types.js";

export function extractSelectorQueriesFromCssText(
  input: SelectorSourceInput,
): ExtractedSelectorQuery[] {
  const cssWithoutComments = input.cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const queries: ExtractedSelectorQuery[] = [];
  const rulePattern = /([^{}]+)\{/g;

  for (const match of cssWithoutComments.matchAll(rulePattern)) {
    const rawSelectorPrelude = match[1];
    const selectorPrelude = rawSelectorPrelude?.trim();
    if (!selectorPrelude || selectorPrelude.startsWith("@")) {
      continue;
    }

    const preludeStartIndex = match.index ?? 0;
    for (const selectorEntry of splitSelectorPrelude(selectorPrelude, preludeStartIndex)) {
      queries.push({
        selectorText: selectorEntry.selectorText,
        source: {
          kind: "css-source",
          selectorAnchor: toSourceAnchor(
            cssWithoutComments,
            input.filePath,
            selectorEntry.startOffset,
            selectorEntry.endOffset,
          ),
        },
      });
    }
  }

  return queries;
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
