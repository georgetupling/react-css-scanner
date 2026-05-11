import { stylesheetNodeId } from "../ids.js";
import { frontendFileProvenance } from "../provenance.js";
import type { FactGraphInput, StyleSheetNode } from "../types.js";
import { sortNodes } from "../utils/sortGraphElements.js";

export function buildStylesheetNodes(input: FactGraphInput): StyleSheetNode[] {
  return sortNodes(
    input.frontends.css.files.map(
      (file): StyleSheetNode => ({
        id: stylesheetNodeId(file.filePath),
        kind: "stylesheet",
        filePath: file.filePath,
        absolutePath: file.absolutePath,
        cssKind: file.cssKind,
        origin: file.origin,
        layerOrderStatements: file.layerOrderStatements.map((statement) => ({
          layerNames: [...statement.layerNames],
          sourceOrder: statement.sourceOrder,
        })),
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: file.filePath,
          summary: "Extracted stylesheet frontend facts",
        }),
      }),
    ),
  );
}
