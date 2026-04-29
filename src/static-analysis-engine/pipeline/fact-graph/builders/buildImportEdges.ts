import type { SourceImportSyntaxRecord } from "../../language-frontends/source/module-syntax/index.js";
import type {
  ExternalResourceNode,
  FactCssSemantics,
  FactImportKind,
  FactImportResolutionStatus,
  FactGraphInput,
  ImportsEdge,
  ModuleNode,
  StyleSheetNode,
} from "../types.js";
import type { ProjectResourceEdge } from "../../workspace-discovery/index.js";
import { externalResourceNodeId, importsEdgeId } from "../ids.js";
import { factGraphProvenance, workspaceFileProvenance } from "../provenance.js";
import { sortEdges, sortNodes } from "../utils/sortGraphElements.js";

export type BuiltImportEdges = {
  all: ImportsEdge[];
  imports: ImportsEdge[];
  externalResources: ExternalResourceNode[];
};

type ImportRecord = {
  importerKind: "source" | "stylesheet";
  importerFilePath: string;
  importKind: FactImportKind;
  specifier: string;
  resolutionStatus: FactImportResolutionStatus;
  resolvedFilePath?: string;
  cssSemantics?: FactCssSemantics;
};

export function buildImportEdges(input: {
  frontends: FactGraphInput["frontends"];
  snapshotEdges: ProjectResourceEdge[];
  moduleNodes: ModuleNode[];
  stylesheetNodes: StyleSheetNode[];
}): BuiltImportEdges {
  const moduleNodeIdByPath = new Map<string, string>(
    input.moduleNodes.map((node) => [normalizeFilePath(node.filePath), node.id]),
  );
  const stylesheetNodeIdByPath = new Map<string, string>();
  for (const stylesheetNode of input.stylesheetNodes) {
    if (stylesheetNode.filePath === undefined) {
      continue;
    }
    stylesheetNodeIdByPath.set(normalizeFilePath(stylesheetNode.filePath), stylesheetNode.id);
  }
  const recordsByKey = new Map<string, ImportRecord>();

  for (const file of input.frontends.source.files) {
    for (const importRecord of file.moduleSyntax.imports) {
      upsertImportRecord({
        recordsByKey,
        key: createImportKey({
          importerKind: "source",
          importerFilePath: file.filePath,
          importKind: importRecord.importKind,
          specifier: importRecord.specifier,
        }),
        record: normalizeFrontendImportRecord({
          importerFilePath: file.filePath,
          importRecord,
        }),
      });
    }
  }

  for (const snapshotEdge of input.snapshotEdges) {
    const record = normalizeSnapshotImportRecord(snapshotEdge);
    if (!record) {
      continue;
    }

    upsertImportRecord({
      recordsByKey,
      key: createImportKey(record),
      record,
    });
  }

  const externalResourcesById = new Map<string, ExternalResourceNode>();
  const imports: ImportsEdge[] = [];

  const sortedRecords = [...recordsByKey.values()].sort(compareImportRecords);
  for (const record of sortedRecords) {
    const normalizedImporterFilePath = normalizeFilePath(record.importerFilePath);
    const importerNodeId =
      record.importerKind === "source"
        ? moduleNodeIdByPath.get(normalizedImporterFilePath)
        : stylesheetNodeIdByPath.get(normalizedImporterFilePath);
    if (!importerNodeId) {
      continue;
    }

    const resolvedImport = resolveImportTarget({
      record,
      moduleNodeIdByPath,
      stylesheetNodeIdByPath,
    });
    const resolvedTargetFilePath =
      resolvedImport.resolvedFilePath ??
      (record.resolutionStatus === "resolved" && record.resolvedFilePath
        ? normalizeFilePath(record.resolvedFilePath)
        : undefined);
    const to =
      resolvedImport.resolvedTargetNodeId ??
      createExternalResourceNode({
        filePath: resolvedTargetFilePath ?? record.specifier,
        resourceKind: resolveImportResourceKind(record),
        externalResourcesById,
      }).id;

    imports.push({
      id: importsEdgeId(importerNodeId, to, record.specifier, record.importKind),
      kind: "imports",
      from: importerNodeId,
      to,
      importerKind: record.importerKind,
      importerFilePath: normalizedImporterFilePath,
      importKind: record.importKind,
      specifier: record.specifier,
      resolutionStatus: record.resolutionStatus,
      ...(resolvedImport.resolvedFilePath
        ? { resolvedFilePath: resolvedImport.resolvedFilePath }
        : {}),
      ...(resolvedImport.resolvedTargetNodeId
        ? { resolvedTargetNodeId: resolvedImport.resolvedTargetNodeId }
        : {}),
      ...(record.cssSemantics ? { cssSemantics: record.cssSemantics } : {}),
      confidence: "high",
      provenance: factGraphProvenance(
        `Mapped import relation from ${record.importerKind} ${record.importerFilePath} to ${record.specifier}`,
      ),
    });
  }

  return {
    all: sortEdges(imports),
    imports: sortEdges(imports),
    externalResources: sortNodes([...externalResourcesById.values()]),
  };
}

function normalizeFrontendImportRecord(input: {
  importerFilePath: string;
  importRecord: SourceImportSyntaxRecord;
}): ImportRecord {
  return {
    importerKind: "source",
    importerFilePath: input.importerFilePath,
    importKind: input.importRecord.importKind,
    specifier: input.importRecord.specifier,
    resolutionStatus: inferFrontendImportResolution(input.importRecord),
    ...(input.importRecord.importKind === "css" || input.importRecord.importKind === "external-css"
      ? { cssSemantics: getCssSemantics(input.importRecord.specifier) }
      : {}),
  };
}

function normalizeSnapshotImportRecord(edge: ProjectResourceEdge): ImportRecord | undefined {
  if (edge.kind === "source-import") {
    return {
      importerKind: "source",
      importerFilePath: edge.importerFilePath,
      importKind: edge.importKind,
      specifier: edge.specifier,
      resolutionStatus: edge.resolutionStatus,
      ...(edge.resolvedFilePath ? { resolvedFilePath: edge.resolvedFilePath } : {}),
      ...(edge.importKind === "css" || edge.importKind === "external-css"
        ? { cssSemantics: getCssSemantics(edge.specifier) }
        : {}),
    };
  }

  if (edge.kind === "stylesheet-import") {
    return {
      importerKind: "stylesheet",
      importerFilePath: edge.importerFilePath,
      importKind: "css",
      specifier: edge.specifier,
      resolutionStatus: "resolved",
      resolvedFilePath: edge.resolvedFilePath,
      cssSemantics: getCssSemantics(edge.specifier),
    };
  }

  if (edge.kind === "package-css-import") {
    return {
      importerKind: edge.importerKind,
      importerFilePath: edge.importerFilePath,
      importKind: "css",
      specifier: edge.specifier,
      resolutionStatus: "resolved",
      resolvedFilePath: edge.resolvedFilePath,
      cssSemantics: getCssSemantics(edge.specifier),
    };
  }

  return undefined;
}

function inferFrontendImportResolution(
  importRecord: SourceImportSyntaxRecord,
): FactImportResolutionStatus {
  if (importRecord.importKind === "external-css") {
    return "external";
  }

  if (importRecord.importKind === "css") {
    return isRemoteSpecifier(importRecord.specifier) ? "external" : "unresolved";
  }

  if (importRecord.importKind === "unknown") {
    return "unsupported";
  }

  return "unresolved";
}

function getCssSemantics(specifier: string): "global" | "module" {
  return /\.module\.[cm]?css$/i.test(specifier) ? "module" : "global";
}

function resolveImportTarget(input: {
  record: ImportRecord;
  moduleNodeIdByPath: Map<string, string>;
  stylesheetNodeIdByPath: Map<string, string>;
}): {
  resolvedTargetNodeId?: string;
  resolvedFilePath?: string;
} {
  if (input.record.resolutionStatus !== "resolved" || !input.record.resolvedFilePath) {
    return {};
  }

  const normalizedResolvedFilePath = normalizeFilePath(input.record.resolvedFilePath);
  if (input.record.importKind === "css") {
    return {
      resolvedFilePath: normalizedResolvedFilePath,
      resolvedTargetNodeId: input.stylesheetNodeIdByPath.get(normalizedResolvedFilePath),
    };
  }

  return {
    resolvedFilePath: normalizedResolvedFilePath,
    resolvedTargetNodeId: input.moduleNodeIdByPath.get(normalizedResolvedFilePath),
  };
}

function createExternalResourceNode(input: {
  filePath: string;
  resourceKind: "package" | "remote" | "unknown";
  externalResourcesById: Map<string, ExternalResourceNode>;
}): ExternalResourceNode {
  const normalizedFilePath = normalizeFilePath(input.filePath);
  const nodeId = externalResourceNodeId(normalizedFilePath, input.resourceKind);
  const existing = input.externalResourcesById.get(nodeId);
  if (existing) {
    return existing;
  }

  const node: ExternalResourceNode = {
    id: nodeId,
    kind: "external-resource",
    specifier: normalizedFilePath,
    resourceKind: input.resourceKind,
    confidence: "high",
    provenance: workspaceFileProvenance({
      filePath: normalizedFilePath,
      summary: "Created synthetic external resource node for import",
    }),
  };
  input.externalResourcesById.set(nodeId, node);
  return node;
}

function resolveImportResourceKind(record: ImportRecord): "package" | "remote" | "unknown" {
  if (record.importKind === "external-css") {
    return "remote";
  }

  if (isRemoteSpecifier(record.specifier)) {
    return "remote";
  }

  if (
    record.importKind === "css" ||
    record.importKind === "source" ||
    record.importKind === "type-only"
  ) {
    return isNonRelativeSpecifier(record.specifier) ? "package" : "unknown";
  }

  return "unknown";
}

function upsertImportRecord(input: {
  recordsByKey: Map<string, ImportRecord>;
  key: string;
  record: ImportRecord;
}): void {
  const existing = input.recordsByKey.get(input.key);
  if (!existing || shouldReplaceImportRecord(existing, input.record)) {
    input.recordsByKey.set(input.key, input.record);
  }
}

function shouldReplaceImportRecord(existing: ImportRecord, candidate: ImportRecord): boolean {
  const existingRank = getResolutionRank(existing.resolutionStatus);
  const candidateRank = getResolutionRank(candidate.resolutionStatus);

  if (candidateRank !== existingRank) {
    return candidateRank > existingRank;
  }

  return false;
}

function getResolutionRank(status: FactImportResolutionStatus): number {
  if (status === "resolved") {
    return 3;
  }
  if (status === "external") {
    return 2;
  }
  if (status === "unresolved") {
    return 1;
  }
  return 0;
}

function compareImportRecords(left: ImportRecord, right: ImportRecord): number {
  return (
    left.importerKind.localeCompare(right.importerKind) ||
    normalizeFilePath(left.importerFilePath).localeCompare(
      normalizeFilePath(right.importerFilePath),
    ) ||
    left.importKind.localeCompare(right.importKind) ||
    left.specifier.localeCompare(right.specifier)
  );
}

function createImportKey(input: {
  importerKind: "source" | "stylesheet";
  importerFilePath: string;
  importKind: FactImportKind;
  specifier: string;
}): string {
  return `${input.importerKind}\0${normalizeFilePath(input.importerFilePath)}\0${input.importKind}\0${normalizeFilePath(input.specifier)}`;
}

function isRemoteSpecifier(specifier: string): boolean {
  return /^https?:\/\//i.test(specifier);
}

function isNonRelativeSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
