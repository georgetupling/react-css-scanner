import type { FactGraphResult } from "../fact-graph/index.js";
import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
} from "../project-evidence/index.js";
import type { RuntimeCssLoadingResult } from "../runtime-css-loading/index.js";

export type RuntimeStylesheetOrderContext = {
  id: string;
  name: string;
  kind: "initial" | "lazy-boundary";
  entryId: string;
  chunkId: string;
  environmentContextId?: string;
  loading: "initial" | "lazy";
  sourceFilePaths: string[];
  stylesheetOrderById: Map<ProjectEvidenceId, number>;
};

export type RuntimeStylesheetOrder = {
  stylesheetOrderById: Map<ProjectEvidenceId, number>;
  contexts: RuntimeStylesheetOrderContext[];
  contextIdsBySourceFilePath: Map<string, string[]>;
  contextById: Map<string, RuntimeStylesheetOrderContext>;
};

export function buildRuntimeStylesheetOrder(input: {
  factGraph: FactGraphResult;
  projectEvidence: ProjectEvidenceAssemblyResult;
  runtimeCssLoading: RuntimeCssLoadingResult;
}): RuntimeStylesheetOrder {
  const stylesheetIdByPath = input.projectEvidence.indexes.stylesheetIdByPath;
  const stylesheetOrdersById = new Map<ProjectEvidenceId, number[]>();
  const initialOrdersByEntryId = new Map<string, string[]>();
  const contexts: RuntimeStylesheetOrderContext[] = [];
  const contextIdsBySourceFilePath = new Map<string, string[]>();

  const initialChunks = input.runtimeCssLoading.chunks
    .filter((chunk) => chunk.loading === "initial")
    .sort(compareRuntimeChunks);
  const lazyChunks = input.runtimeCssLoading.chunks
    .filter((chunk) => chunk.loading === "lazy")
    .sort(compareRuntimeChunks);

  for (const chunk of initialChunks) {
    const environmentContext = findEnvironmentContextForChunk({
      runtimeCssLoading: input.runtimeCssLoading,
      chunk,
      kind: "initial",
    });
    const orderedStylesheetPaths = getDefiniteOrderedStylesheetsForChunk({
      input,
      chunk,
    });
    if (!orderedStylesheetPaths) {
      continue;
    }

    initialOrdersByEntryId.set(chunk.entryId, orderedStylesheetPaths);
    const context = createRuntimeContext({
      input,
      chunk,
      environmentContext,
      orderedStylesheetPaths,
    });
    if (context) {
      contexts.push(context);
      indexRuntimeContext(contextIdsBySourceFilePath, context);
    }

    for (const [index, stylesheetPath] of orderedStylesheetPaths.entries()) {
      const stylesheetId = stylesheetIdByPath.get(stylesheetPath);
      if (!stylesheetId) {
        continue;
      }
      const orders = stylesheetOrdersById.get(stylesheetId) ?? [];
      orders.push(index);
      stylesheetOrdersById.set(stylesheetId, orders);
    }
  }

  for (const chunk of lazyChunks) {
    const environmentContext = findEnvironmentContextForChunk({
      runtimeCssLoading: input.runtimeCssLoading,
      chunk,
      kind: "lazy-boundary",
    });
    const lazyOrderedStylesheetPaths = getDefiniteOrderedStylesheetsForChunk({
      input,
      chunk,
    });
    const initialOrderedStylesheetPaths = initialOrdersByEntryId.get(chunk.entryId);
    if (!lazyOrderedStylesheetPaths || !initialOrderedStylesheetPaths) {
      continue;
    }

    const context = createRuntimeContext({
      input,
      chunk,
      environmentContext,
      orderedStylesheetPaths: [
        ...initialOrderedStylesheetPaths,
        ...lazyOrderedStylesheetPaths.filter(
          (stylesheetPath) => !initialOrderedStylesheetPaths.includes(stylesheetPath),
        ),
      ],
    });
    if (context) {
      contexts.push(context);
      indexRuntimeContext(contextIdsBySourceFilePath, context);
    }
  }

  const stableOrder = new Map<ProjectEvidenceId, number>();
  for (const [stylesheetId, orders] of stylesheetOrdersById) {
    const uniqueOrders = [...new Set(orders)];
    if (uniqueOrders.length === 1) {
      stableOrder.set(stylesheetId, uniqueOrders[0]);
    }
  }
  const contextById = new Map(contexts.map((context) => [context.id, context]));
  for (const [sourceFilePath, contextIds] of contextIdsBySourceFilePath) {
    contextIdsBySourceFilePath.set(
      sourceFilePath,
      [...contextIds].sort((left, right) => left.localeCompare(right)),
    );
  }

  return {
    stylesheetOrderById: stableOrder,
    contexts: contexts.sort((left, right) => left.id.localeCompare(right.id)),
    contextIdsBySourceFilePath,
    contextById,
  };
}

function getDefiniteOrderedStylesheetsForChunk(input: {
  input: {
    factGraph: FactGraphResult;
    projectEvidence: ProjectEvidenceAssemblyResult;
    runtimeCssLoading: RuntimeCssLoadingResult;
  };
  chunk: RuntimeCssLoadingResult["chunks"][number];
}): string[] | undefined {
  const chunkStylesheetPaths = input.chunk.stylesheetFilePaths.map(normalizeProjectPath);
  const definiteStylesheetPaths = new Set(
    input.input.runtimeCssLoading.availability
      .filter(
        (availability) =>
          availability.chunkId === input.chunk.id && availability.availability === "definite",
      )
      .map((availability) => normalizeProjectPath(availability.stylesheetFilePath)),
  );
  if (
    !chunkStylesheetPaths.every((stylesheetPath) => definiteStylesheetPaths.has(stylesheetPath))
  ) {
    return undefined;
  }

  return collectRuntimeOrderedStylesheets({
    factGraph: input.input.factGraph,
    entrySourceFilePath: input.chunk.rootSourceFilePath,
    allowedSourceFilePaths: new Set(input.chunk.sourceFilePaths.map(normalizeProjectPath)),
    allowedStylesheetFilePaths: new Set(chunkStylesheetPaths),
  });
}

function createRuntimeContext(input: {
  input: {
    projectEvidence: ProjectEvidenceAssemblyResult;
  };
  chunk: RuntimeCssLoadingResult["chunks"][number];
  environmentContext?: NonNullable<RuntimeCssLoadingResult["environmentContexts"]>[number];
  orderedStylesheetPaths: string[];
}): RuntimeStylesheetOrderContext | undefined {
  const stylesheetOrderById = new Map<ProjectEvidenceId, number>();
  for (const [index, stylesheetPath] of input.orderedStylesheetPaths.entries()) {
    const stylesheetId = input.input.projectEvidence.indexes.stylesheetIdByPath.get(
      normalizeProjectPath(stylesheetPath),
    );
    if (!stylesheetId) {
      continue;
    }
    stylesheetOrderById.set(stylesheetId, index);
  }
  if (stylesheetOrderById.size === 0 && input.chunk.stylesheetFilePaths.length > 0) {
    return undefined;
  }

  return {
    id: runtimeStylesheetOrderContextId(input.chunk, input.environmentContext),
    name:
      input.environmentContext?.name ??
      (input.chunk.loading === "initial"
        ? "initial"
        : `lazy-boundary:${normalizeProjectPath(input.chunk.rootSourceFilePath)}`),
    kind: input.chunk.loading === "initial" ? "initial" : "lazy-boundary",
    entryId: input.chunk.entryId,
    chunkId: input.chunk.id,
    ...(input.environmentContext ? { environmentContextId: input.environmentContext.id } : {}),
    loading: input.chunk.loading,
    sourceFilePaths: input.chunk.sourceFilePaths.map(normalizeProjectPath).sort(compareStrings),
    stylesheetOrderById,
  };
}

function indexRuntimeContext(
  contextIdsBySourceFilePath: Map<string, string[]>,
  context: RuntimeStylesheetOrderContext,
): void {
  for (const sourceFilePath of context.sourceFilePaths) {
    const contextIds = contextIdsBySourceFilePath.get(sourceFilePath) ?? [];
    if (!contextIds.includes(context.id)) {
      contextIds.push(context.id);
    }
    contextIdsBySourceFilePath.set(sourceFilePath, contextIds);
  }
}

function runtimeStylesheetOrderContextId(
  chunk: RuntimeCssLoadingResult["chunks"][number],
  environmentContext?: NonNullable<RuntimeCssLoadingResult["environmentContexts"]>[number],
): string {
  return (
    environmentContext?.id ?? ["runtime-css", chunk.entryId, chunk.loading, chunk.id].join(":")
  );
}

function findEnvironmentContextForChunk(input: {
  runtimeCssLoading: RuntimeCssLoadingResult;
  chunk: RuntimeCssLoadingResult["chunks"][number];
  kind: "initial" | "lazy-boundary";
}): NonNullable<RuntimeCssLoadingResult["environmentContexts"]>[number] | undefined {
  return input.runtimeCssLoading.environmentContexts
    ?.filter((context) => context.kind === input.kind && context.chunkIds.includes(input.chunk.id))
    .sort((left, right) => left.id.localeCompare(right.id))[0];
}

function collectRuntimeOrderedStylesheets(input: {
  factGraph: FactGraphResult;
  entrySourceFilePath: string;
  allowedSourceFilePaths: Set<string>;
  allowedStylesheetFilePaths: Set<string>;
}): string[] {
  const importsBySourcePath = new Map<
    string,
    Array<{
      specifier: string;
      importKind: string;
      importLoading: string;
      resolvedFilePath?: string;
    }>
  >();
  for (const sourceFile of input.factGraph.frontends.source.files) {
    importsBySourcePath.set(
      sourceFile.filePath,
      sourceFile.moduleSyntax.imports.map((importRecord) => {
        const edge = input.factGraph.graph.edges.imports.find(
          (candidate) =>
            candidate.importerKind === "source" &&
            candidate.importerFilePath === sourceFile.filePath &&
            candidate.specifier === importRecord.specifier &&
            candidate.importKind === importRecord.importKind &&
            candidate.importLoading === importRecord.importLoading,
        );
        return {
          specifier: importRecord.specifier,
          importKind: importRecord.importKind,
          importLoading: importRecord.importLoading,
          resolvedFilePath: edge?.resolvedFilePath,
        };
      }),
    );
  }

  const stylesheetImportsByPath = new Map<string, string[]>();
  for (const edge of input.factGraph.snapshot.edges) {
    if (
      (edge.kind === "stylesheet-import" ||
        (edge.kind === "package-css-import" && edge.importerKind === "stylesheet")) &&
      edge.resolvedFilePath
    ) {
      const imports = stylesheetImportsByPath.get(edge.importerFilePath) ?? [];
      imports.push(edge.resolvedFilePath.replace(/\\/g, "/"));
      stylesheetImportsByPath.set(edge.importerFilePath.replace(/\\/g, "/"), imports);
    }
  }

  const orderedStylesheets: string[] = [];
  const visitedSourcePaths = new Set<string>();
  const visitedStylesheetPaths = new Set<string>();

  visitSource(normalizeProjectPath(input.entrySourceFilePath));
  return orderedStylesheets;

  function visitSource(sourceFilePath: string): void {
    if (
      visitedSourcePaths.has(sourceFilePath) ||
      !input.allowedSourceFilePaths.has(sourceFilePath)
    ) {
      return;
    }
    visitedSourcePaths.add(sourceFilePath);

    for (const importRecord of importsBySourcePath.get(sourceFilePath) ?? []) {
      const resolvedFilePath = importRecord.resolvedFilePath?.replace(/\\/g, "/");
      if (!resolvedFilePath || importRecord.importLoading !== "static") {
        continue;
      }
      if (importRecord.importKind === "css") {
        visitStylesheet(resolvedFilePath);
      }
      if (importRecord.importKind === "source") {
        visitSource(resolvedFilePath);
      }
    }
  }

  function visitStylesheet(stylesheetPath: string): void {
    if (
      visitedStylesheetPaths.has(stylesheetPath) ||
      !input.allowedStylesheetFilePaths.has(stylesheetPath)
    ) {
      return;
    }
    visitedStylesheetPaths.add(stylesheetPath);

    for (const importedStylesheetPath of stylesheetImportsByPath.get(stylesheetPath) ?? []) {
      visitStylesheet(importedStylesheetPath);
    }
    orderedStylesheets.push(stylesheetPath);
  }
}

function compareRuntimeChunks(
  left: RuntimeCssLoadingResult["chunks"][number],
  right: RuntimeCssLoadingResult["chunks"][number],
): number {
  return (
    left.entryId.localeCompare(right.entryId) ||
    left.loading.localeCompare(right.loading) ||
    left.rootSourceFilePath.localeCompare(right.rootSourceFilePath) ||
    left.id.localeCompare(right.id)
  );
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
