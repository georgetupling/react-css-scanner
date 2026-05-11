import type { FactGraphResult } from "../fact-graph/index.js";
import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
} from "../project-evidence/index.js";
import type { RuntimeCssLoadingResult } from "../runtime-css-loading/index.js";

export function buildRuntimeStylesheetOrder(input: {
  factGraph: FactGraphResult;
  projectEvidence: ProjectEvidenceAssemblyResult;
  runtimeCssLoading: RuntimeCssLoadingResult;
}): Map<ProjectEvidenceId, number> {
  const stylesheetIdByPath = input.projectEvidence.indexes.stylesheetIdByPath;
  const stylesheetOrdersById = new Map<ProjectEvidenceId, number[]>();

  for (const chunk of input.runtimeCssLoading.chunks) {
    if (chunk.loading !== "initial") {
      continue;
    }
    const definiteStylesheetPaths = new Set(
      input.runtimeCssLoading.availability
        .filter(
          (availability) =>
            availability.chunkId === chunk.id && availability.availability === "definite",
        )
        .map((availability) => availability.stylesheetFilePath),
    );
    if (
      !chunk.stylesheetFilePaths.every((stylesheetPath) =>
        definiteStylesheetPaths.has(stylesheetPath),
      )
    ) {
      continue;
    }

    const orderedStylesheetPaths = collectRuntimeOrderedStylesheets({
      factGraph: input.factGraph,
      entrySourceFilePath: chunk.rootSourceFilePath,
      allowedSourceFilePaths: new Set(chunk.sourceFilePaths),
      allowedStylesheetFilePaths: new Set(chunk.stylesheetFilePaths),
    });
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

  const stableOrder = new Map<ProjectEvidenceId, number>();
  for (const [stylesheetId, orders] of stylesheetOrdersById) {
    const uniqueOrders = [...new Set(orders)];
    if (uniqueOrders.length === 1) {
      stableOrder.set(stylesheetId, uniqueOrders[0]);
    }
  }
  return stableOrder;
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

  visitSource(input.entrySourceFilePath.replace(/\\/g, "/"));
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
