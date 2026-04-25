import { parseSourceFile } from "../../pipeline/parse/index.js";
import type { ParseStageResult } from "./types.js";

export function runParseStage(
  sourceFiles: Array<{
    filePath: string;
    sourceText: string;
  }>,
): ParseStageResult {
  return {
    parsedFiles: sourceFiles.map((sourceFile) => ({
      filePath: sourceFile.filePath,
      parsedSourceFile: parseSourceFile(sourceFile),
    })),
  };
}
