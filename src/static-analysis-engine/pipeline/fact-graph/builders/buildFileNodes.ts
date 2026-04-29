import { fileResourceNodeId } from "../ids.js";
import { workspaceFileProvenance } from "../provenance.js";
import type { FactGraphInput, FileResourceNode } from "../types.js";
import { sortNodes } from "../utils/sortGraphElements.js";

export function buildFileNodes(input: FactGraphInput): FileResourceNode[] {
  const sourceFileNodes = input.snapshot.files.sourceFiles.map(
    (file): FileResourceNode => ({
      id: fileResourceNodeId(file.filePath),
      kind: "file-resource",
      filePath: file.filePath,
      absolutePath: file.absolutePath,
      fileKind: "source",
      confidence: "high",
      provenance: workspaceFileProvenance({
        filePath: file.filePath,
        summary: "Discovered source file",
      }),
    }),
  );
  const stylesheetFileNodes = input.snapshot.files.stylesheets.map(
    (file): FileResourceNode => ({
      id: fileResourceNodeId(file.filePath),
      kind: "file-resource",
      filePath: file.filePath,
      absolutePath: file.absolutePath,
      fileKind: "stylesheet",
      confidence: "high",
      provenance: workspaceFileProvenance({
        filePath: file.filePath,
        summary: "Discovered stylesheet file",
      }),
    }),
  );
  const htmlFileNodes = input.snapshot.files.htmlFiles.map(
    (file): FileResourceNode => ({
      id: fileResourceNodeId(file.filePath),
      kind: "file-resource",
      filePath: file.filePath,
      absolutePath: file.absolutePath,
      fileKind: "html",
      confidence: "high",
      provenance: workspaceFileProvenance({
        filePath: file.filePath,
        summary: "Discovered HTML file",
      }),
    }),
  );
  const configFileNodes = input.snapshot.files.configFiles
    .filter((file): file is typeof file & { filePath: string } => Boolean(file.filePath))
    .map(
      (file): FileResourceNode => ({
        id: fileResourceNodeId(file.filePath),
        kind: "file-resource",
        filePath: file.filePath,
        fileKind: "config",
        confidence: "high",
        provenance: workspaceFileProvenance({
          filePath: file.filePath,
          summary: "Loaded config file",
        }),
      }),
    );

  return sortNodes([
    ...sourceFileNodes,
    ...stylesheetFileNodes,
    ...htmlFileNodes,
    ...configFileNodes,
  ]);
}
