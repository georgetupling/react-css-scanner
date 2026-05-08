import { moduleNodeId } from "../ids.js";
import { frontendFileProvenance } from "../provenance.js";
import type { FactGraphInput, ModuleNode } from "../types.js";
import { sortNodes } from "../utils/sortGraphElements.js";

export function buildModuleNodes(input: FactGraphInput): ModuleNode[] {
  const sourceModules = input.frontends.source.files.map(
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
  );
  const jsonModules = input.frontends.json.files.map(
    (file): ModuleNode => ({
      id: moduleNodeId(file.filePath),
      kind: "module",
      filePath: file.filePath,
      absolutePath: file.absolutePath,
      moduleKind: "json",
      languageKind: "json",
      jsonExports: file.exports.flatMap((exportFact) =>
        exportFact.value
          ? [
              {
                exportedName: exportFact.exportedName,
                value: exportFact.value,
              },
            ]
          : [],
      ),
      confidence: "high",
      provenance: frontendFileProvenance({
        filePath: file.filePath,
        summary: "Extracted JSON module frontend facts",
      }),
    }),
  );

  return sortNodes([...sourceModules, ...jsonModules]);
}
