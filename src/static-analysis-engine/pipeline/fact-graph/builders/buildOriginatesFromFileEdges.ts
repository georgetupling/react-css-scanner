import type {
  FileResourceNode,
  ModuleNode,
  OriginatesFromFileEdge,
  StyleSheetNode,
} from "../types.js";
import { originatesFromFileEdgeId } from "../ids.js";
import { factGraphProvenance } from "../provenance.js";

export function buildOriginatesFromFileEdges(input: {
  fileNodes: FileResourceNode[];
  moduleNodes: ModuleNode[];
  stylesheetNodes: StyleSheetNode[];
}): OriginatesFromFileEdge[] {
  const fileNodeIdsByPath = new Map(input.fileNodes.map((node) => [node.filePath, node.id]));
  const moduleEdges = input.moduleNodes.flatMap((node): OriginatesFromFileEdge[] => {
    const fileNodeId = fileNodeIdsByPath.get(node.filePath);
    if (!fileNodeId) {
      return [];
    }

    return [buildOriginatesFromFileEdge(node.id, fileNodeId)];
  });
  const stylesheetEdges = input.stylesheetNodes.flatMap((node): OriginatesFromFileEdge[] => {
    if (!node.filePath || node.origin === "remote") {
      return [];
    }

    const fileNodeId = fileNodeIdsByPath.get(node.filePath);
    if (!fileNodeId) {
      return [];
    }

    return [buildOriginatesFromFileEdge(node.id, fileNodeId)];
  });

  return [...moduleEdges, ...stylesheetEdges];
}

function buildOriginatesFromFileEdge(from: string, to: string): OriginatesFromFileEdge {
  return {
    id: originatesFromFileEdgeId(from, to),
    kind: "originates-from-file",
    from,
    to,
    confidence: "high",
    provenance: factGraphProvenance("Linked graph node to originating file resource"),
  };
}
