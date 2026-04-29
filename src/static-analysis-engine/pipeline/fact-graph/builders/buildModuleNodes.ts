import { moduleNodeId } from "../ids.js";
import { frontendFileProvenance } from "../provenance.js";
import type { FactGraphInput, ModuleNode } from "../types.js";
import { sortNodes } from "../utils/sortGraphElements.js";

export function buildModuleNodes(input: FactGraphInput): ModuleNode[] {
  return sortNodes(
    input.frontends.source.files.map(
      (file): ModuleNode => ({
        id: moduleNodeId(file.filePath),
        kind: "module",
        filePath: file.filePath,
        absolutePath: file.absolutePath,
        moduleKind: "source",
        languageKind: file.languageKind,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: file.filePath,
          summary: "Extracted source module frontend facts",
        }),
      }),
    ),
  );
}
