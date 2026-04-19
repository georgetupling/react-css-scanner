import { parseSelectorBranch } from "./parseSelectorBranch.js";
import type { ParsedCssAtRuleContext, ParsedCssSelectorEntry } from "./types.js";

export function extractParsedSelectorEntriesFromSelectorPrelude(input: {
  selectorPrelude: string;
  preludeStartIndex: number;
  sourceText: string;
  filePath?: string;
  atRuleContext?: ParsedCssAtRuleContext[];
}): ParsedCssSelectorEntry[] {
  const entries: ParsedCssSelectorEntry[] = [];
  let cursor = 0;

  for (const rawPart of input.selectorPrelude.split(",")) {
    const rawPartStart = cursor;
    const rawPartEnd = rawPartStart + rawPart.length;
    const trimmed = rawPart.trim();

    if (trimmed) {
      const leadingWhitespace = rawPart.match(/^\s*/)?.[0].length ?? 0;
      const trailingWhitespace = rawPart.match(/\s*$/)?.[0].length ?? 0;
      const startOffset = input.preludeStartIndex + rawPartStart + leadingWhitespace;
      const endOffset = input.preludeStartIndex + rawPartEnd - trailingWhitespace;
      const parsedBranch = parseSelectorBranch(trimmed);

      if (parsedBranch) {
        entries.push({
          selectorText: trimmed,
          parsedBranch,
          selectorAnchor: toSourceAnchor(input.sourceText, input.filePath, startOffset, endOffset),
          ...(input.atRuleContext && input.atRuleContext.length > 0
            ? {
                atRuleContext: input.atRuleContext,
              }
            : {}),
        });
      }
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
