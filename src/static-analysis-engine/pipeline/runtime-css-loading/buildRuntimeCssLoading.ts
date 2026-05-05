import type { FactGraphResult } from "../fact-graph/index.js";
import { collectNextRuntimeSourceFilePaths, isNextEntry } from "./adapters/next.js";
import {
  detectRuntimeCssBundlerProfiles,
  selectRuntimeCssBundlerProfile,
} from "./bundlerProfiles.js";
import { collectAppEntries } from "./entries.js";
import {
  collectBundleStylesheetPaths,
  collectReachableRuntimeSourceFilePaths,
  collectReachableSourceFilePaths,
  enqueueDynamicImportTargets,
} from "./graphTraversal.js";
import { pushMapValue } from "./mapUtils.js";
import { normalizeProjectPath } from "./pathUtils.js";
import type {
  RuntimeCssAvailability,
  RuntimeCssBundlerProfile,
  RuntimeCssChunk,
  RuntimeCssEntry,
  RuntimeCssLoadingResult,
} from "./types.js";

export function buildRuntimeCssLoading(input: {
  factGraph: FactGraphResult;
}): RuntimeCssLoadingResult {
  const graph = input.factGraph.graph;
  const moduleFilePaths = graph.nodes.modules
    .map((moduleNode) => normalizeProjectPath(moduleNode.filePath))
    .sort((left, right) => left.localeCompare(right));
  const allStylesheetFilePaths = graph.nodes.stylesheets
    .map((stylesheet) => stylesheet.filePath)
    .filter((filePath): filePath is string => Boolean(filePath))
    .map(normalizeProjectPath)
    .sort((left, right) => left.localeCompare(right));

  const importedSourcePathsBySourcePath = new Map<string, string[]>();
  const dynamicallyImportedSourcePathsBySourcePath = new Map<string, string[]>();
  const sourceImportedStylesheetsBySourcePath = new Map<string, string[]>();
  const sourceDynamicallyImportedStylesheetsBySourcePath = new Map<string, string[]>();
  const unresolvedDynamicImportSpecifiersBySourcePath = new Map<string, string[]>();

  for (const edge of graph.edges.imports) {
    if (edge.importerKind !== "source") {
      continue;
    }

    const importerPath = normalizeProjectPath(edge.importerFilePath);
    if (
      edge.importLoading === "dynamic" &&
      edge.importKind === "source" &&
      edge.resolutionStatus !== "resolved"
    ) {
      pushMapValue(unresolvedDynamicImportSpecifiersBySourcePath, importerPath, edge.specifier);
      continue;
    }
    if (!edge.resolvedFilePath) {
      continue;
    }

    const importedPath = normalizeProjectPath(edge.resolvedFilePath);
    if (edge.importKind === "source") {
      if (edge.importLoading === "static") {
        pushMapValue(importedSourcePathsBySourcePath, importerPath, importedPath);
      } else {
        pushMapValue(dynamicallyImportedSourcePathsBySourcePath, importerPath, importedPath);
      }
      continue;
    }
    if (edge.importKind === "css" && edge.importLoading === "static") {
      pushMapValue(sourceImportedStylesheetsBySourcePath, importerPath, importedPath);
      continue;
    }
    if (edge.importKind === "css" && edge.importLoading === "dynamic") {
      pushMapValue(sourceDynamicallyImportedStylesheetsBySourcePath, importerPath, importedPath);
    }
  }

  const importedStylesheetPathsByStylesheetPath = new Map<string, string[]>();
  for (const edge of input.factGraph.snapshot.edges) {
    if (edge.kind === "stylesheet-import" && edge.resolvedFilePath) {
      pushMapValue(
        importedStylesheetPathsByStylesheetPath,
        normalizeProjectPath(edge.importerFilePath),
        normalizeProjectPath(edge.resolvedFilePath),
      );
      continue;
    }
    if (
      edge.kind === "package-css-import" &&
      edge.importerKind === "stylesheet" &&
      edge.resolvedFilePath
    ) {
      pushMapValue(
        importedStylesheetPathsByStylesheetPath,
        normalizeProjectPath(edge.importerFilePath),
        normalizeProjectPath(edge.resolvedFilePath),
      );
    }
  }

  const bundlerProfiles = detectRuntimeCssBundlerProfiles({
    bundlerConfigFiles: input.factGraph.snapshot.files.bundlerConfigFiles,
    packageJsonFiles: input.factGraph.snapshot.files.packageJsonFiles,
  });
  const appEntries = collectAppEntries({
    snapshotEdges: input.factGraph.snapshot.edges,
    bundlerConfigFiles: input.factGraph.snapshot.files.bundlerConfigFiles,
    packageJsonFiles: input.factGraph.snapshot.files.packageJsonFiles,
    moduleFilePaths,
  });
  const selectedBundlerProfile = selectRuntimeCssBundlerProfile(bundlerProfiles);
  const entries = appEntries.map(createRuntimeCssEntry).sort(compareRuntimeCssEntries);
  const chunks: RuntimeCssChunk[] = [];
  const chunkKeys = new Set<string>();
  const availability: RuntimeCssAvailability[] = [];
  const availabilityKeys = new Set<string>();

  for (const entry of entries) {
    const entryBundleSourceFilePaths = collectReachableSourceFilePaths({
      entrySourceFilePath: entry.entrySourceFilePath,
      importedSourcePathsBySourcePath,
      moduleFilePaths,
    });
    const initialSourceFilePaths = isNextEntry(entry)
      ? collectNextRuntimeSourceFilePaths({
          entry,
          entryBundleSourceFilePaths,
          moduleFilePaths,
        })
      : entryBundleSourceFilePaths;
    const initialStylesheetPaths = collectBundleStylesheetPaths({
      sourceFilePaths: entryBundleSourceFilePaths,
      sourceImportedStylesheetsBySourcePath,
      importedStylesheetPathsByStylesheetPath,
    });
    const initialChunk = createRuntimeCssChunk({
      entry,
      loading: "initial",
      rootSourceFilePath: entry.entrySourceFilePath,
      sourceFilePaths: initialSourceFilePaths,
      stylesheetFilePaths: initialStylesheetPaths,
    });
    pushChunkAndAvailability({
      chunks,
      chunkKeys,
      availability,
      availabilityKeys,
      entry,
      chunk: initialChunk,
      bundlerProfile: selectedBundlerProfile,
      sourceDynamicallyImportedStylesheetsBySourcePath,
      unresolvedDynamicImportSpecifiersBySourcePath,
      allStylesheetFilePaths,
      availabilityReason: "stylesheet is loaded by the same HTML app entry bundle",
    });

    if (selectedBundlerProfile.cssLoading === "single-initial-stylesheet") {
      const runtimeSourceFilePaths = collectReachableRuntimeSourceFilePaths({
        entrySourceFilePath: entry.entrySourceFilePath,
        staticImportedSourcePathsBySourcePath: importedSourcePathsBySourcePath,
        dynamicallyImportedSourcePathsBySourcePath,
        moduleFilePaths,
      });
      const runtimeStylesheetPaths = collectBundleStylesheetPaths({
        sourceFilePaths: runtimeSourceFilePaths,
        sourceImportedStylesheetsBySourcePath,
        importedStylesheetPathsByStylesheetPath,
      });
      const expandedInitialChunk = createRuntimeCssChunk({
        entry,
        loading: "initial",
        rootSourceFilePath: entry.entrySourceFilePath,
        sourceFilePaths: runtimeSourceFilePaths,
        stylesheetFilePaths: runtimeStylesheetPaths,
        reason: "all runtime CSS is extracted into the initial stylesheet by bundler configuration",
      });
      replaceChunk(chunks, chunkKeys, expandedInitialChunk);
      pushChunkAvailability({
        availability,
        availabilityKeys,
        entry,
        chunk: expandedInitialChunk,
        bundlerProfile: selectedBundlerProfile,
        sourceDynamicallyImportedStylesheetsBySourcePath,
        unresolvedDynamicImportSpecifiersBySourcePath,
        allStylesheetFilePaths,
        availabilityReason: "stylesheet is loaded by the same HTML app entry bundle",
      });
      continue;
    }

    const initialSourceFilePathSet = new Set(initialSourceFilePaths);
    const lazyRootQueue: string[] = [];
    const queuedLazyRootSourceFilePaths = new Set<string>();
    const processedLazyRootSourceFilePaths = new Set<string>();
    enqueueDynamicImportTargets({
      sourceFilePaths: initialSourceFilePaths,
      dynamicallyImportedSourcePathsBySourcePath,
      excludedSourceFilePaths: initialSourceFilePathSet,
      queue: lazyRootQueue,
      queued: queuedLazyRootSourceFilePaths,
      processed: processedLazyRootSourceFilePaths,
    });

    while (lazyRootQueue.length > 0) {
      const lazyRootSourceFilePath = lazyRootQueue.shift();
      if (!lazyRootSourceFilePath) {
        continue;
      }
      queuedLazyRootSourceFilePaths.delete(lazyRootSourceFilePath);
      if (
        processedLazyRootSourceFilePaths.has(lazyRootSourceFilePath) ||
        initialSourceFilePathSet.has(lazyRootSourceFilePath)
      ) {
        continue;
      }
      processedLazyRootSourceFilePaths.add(lazyRootSourceFilePath);

      const lazySourceFilePaths = collectReachableSourceFilePaths({
        entrySourceFilePath: lazyRootSourceFilePath,
        importedSourcePathsBySourcePath,
        moduleFilePaths,
      });
      const lazyStylesheetPaths = collectBundleStylesheetPaths({
        sourceFilePaths: lazySourceFilePaths,
        sourceImportedStylesheetsBySourcePath,
        importedStylesheetPathsByStylesheetPath,
      });
      if (lazySourceFilePaths.length === 0) {
        continue;
      }
      const lazyChunk = createRuntimeCssChunk({
        entry,
        loading: "lazy",
        rootSourceFilePath: lazyRootSourceFilePath,
        sourceFilePaths: lazySourceFilePaths,
        stylesheetFilePaths: lazyStylesheetPaths,
      });
      pushChunkAndAvailability({
        chunks,
        chunkKeys,
        availability,
        availabilityKeys,
        entry,
        chunk: lazyChunk,
        bundlerProfile: selectedBundlerProfile,
        sourceDynamicallyImportedStylesheetsBySourcePath,
        unresolvedDynamicImportSpecifiersBySourcePath,
        allStylesheetFilePaths,
        availabilityReason: "stylesheet is loaded by the same lazy runtime CSS chunk",
      });
      enqueueDynamicImportTargets({
        sourceFilePaths: lazySourceFilePaths,
        dynamicallyImportedSourcePathsBySourcePath,
        excludedSourceFilePaths: initialSourceFilePathSet,
        queue: lazyRootQueue,
        queued: queuedLazyRootSourceFilePaths,
        processed: processedLazyRootSourceFilePaths,
      });
    }
  }

  if (selectedBundlerProfile.cssLoading === "generic-esm-chunks") {
    pushGenericBundlerPossibleAvailabilityRecords({
      availability,
      availabilityKeys,
      entries,
      chunks,
      bundlerProfile: selectedBundlerProfile,
    });
  }

  return {
    bundlerProfiles,
    entries,
    chunks: chunks.sort(compareRuntimeCssChunks),
    availability: availability.sort(compareRuntimeCssAvailability),
  };
}

function createRuntimeCssEntry(input: {
  kind: RuntimeCssEntry["kind"];
  entrySourceFilePath: string;
  htmlFilePath?: string;
  confidence: RuntimeCssEntry["confidence"];
  reason: string;
}): RuntimeCssEntry {
  return {
    id: runtimeCssEntryId(input),
    kind: input.kind,
    entrySourceFilePath: input.entrySourceFilePath,
    ...(input.htmlFilePath ? { htmlFilePath: input.htmlFilePath } : {}),
    confidence: input.confidence,
    reason: input.reason,
  };
}

function createRuntimeCssChunk(input: {
  entry: RuntimeCssEntry;
  loading: RuntimeCssChunk["loading"];
  rootSourceFilePath: string;
  sourceFilePaths: string[];
  stylesheetFilePaths: string[];
  reason?: string;
}): RuntimeCssChunk {
  return {
    id: runtimeCssChunkId({
      entryId: input.entry.id,
      loading: input.loading,
      rootSourceFilePath: input.rootSourceFilePath,
    }),
    entryId: input.entry.id,
    loading: input.loading,
    rootSourceFilePath: input.rootSourceFilePath,
    sourceFilePaths: input.sourceFilePaths,
    stylesheetFilePaths: input.stylesheetFilePaths,
    reason:
      input.reason ??
      (input.loading === "initial"
        ? "static imports reachable from runtime CSS entry"
        : "static imports reachable from dynamic import chunk root"),
  };
}

function pushChunkAndAvailability(input: {
  chunks: RuntimeCssChunk[];
  chunkKeys: Set<string>;
  availability: RuntimeCssAvailability[];
  availabilityKeys: Set<string>;
  entry: RuntimeCssEntry;
  chunk: RuntimeCssChunk;
  bundlerProfile: RuntimeCssBundlerProfile;
  sourceDynamicallyImportedStylesheetsBySourcePath: Map<string, string[]>;
  unresolvedDynamicImportSpecifiersBySourcePath: Map<string, string[]>;
  allStylesheetFilePaths: string[];
  availabilityReason: RuntimeCssAvailability["reason"];
}): void {
  pushUniqueChunk(input.chunks, input.chunkKeys, input.chunk);
  pushChunkAvailability(input);
}

function pushChunkAvailability(input: {
  availability: RuntimeCssAvailability[];
  availabilityKeys: Set<string>;
  entry: RuntimeCssEntry;
  chunk: RuntimeCssChunk;
  bundlerProfile: RuntimeCssBundlerProfile;
  sourceDynamicallyImportedStylesheetsBySourcePath: Map<string, string[]>;
  unresolvedDynamicImportSpecifiersBySourcePath: Map<string, string[]>;
  allStylesheetFilePaths: string[];
  availabilityReason: RuntimeCssAvailability["reason"];
}): void {
  pushAvailabilityRecords({
    availability: input.availability,
    availabilityKeys: input.availabilityKeys,
    entry: input.entry,
    chunk: input.chunk,
    bundlerProfile: input.bundlerProfile,
    availabilityState: "definite",
    reason: input.availabilityReason,
  });
  pushDynamicCssImportAvailabilityRecords({
    availability: input.availability,
    availabilityKeys: input.availabilityKeys,
    entry: input.entry,
    chunk: input.chunk,
    bundlerProfile: input.bundlerProfile,
    sourceDynamicallyImportedStylesheetsBySourcePath:
      input.sourceDynamicallyImportedStylesheetsBySourcePath,
  });
  pushUnresolvedDynamicImportAvailabilityRecords({
    availability: input.availability,
    availabilityKeys: input.availabilityKeys,
    entry: input.entry,
    chunk: input.chunk,
    bundlerProfile: input.bundlerProfile,
    stylesheetFilePaths: input.allStylesheetFilePaths,
    unresolvedDynamicImportSpecifiersBySourcePath:
      input.unresolvedDynamicImportSpecifiersBySourcePath,
  });
}

function pushUniqueChunk(
  chunks: RuntimeCssChunk[],
  chunkKeys: Set<string>,
  chunk: RuntimeCssChunk,
): void {
  if (chunkKeys.has(chunk.id)) {
    return;
  }
  chunkKeys.add(chunk.id);
  chunks.push(chunk);
}

function replaceChunk(
  chunks: RuntimeCssChunk[],
  chunkKeys: Set<string>,
  chunk: RuntimeCssChunk,
): void {
  const index = chunks.findIndex((candidate) => candidate.id === chunk.id);
  if (index >= 0) {
    chunks[index] = chunk;
    chunkKeys.add(chunk.id);
    return;
  }
  pushUniqueChunk(chunks, chunkKeys, chunk);
}

function pushAvailabilityRecords(input: {
  availability: RuntimeCssAvailability[];
  availabilityKeys: Set<string>;
  entry: RuntimeCssEntry;
  chunk: RuntimeCssChunk;
  bundlerProfile: RuntimeCssBundlerProfile;
  availabilityState: RuntimeCssAvailability["availability"];
  reason: RuntimeCssAvailability["reason"];
}): void {
  for (const stylesheetFilePath of input.chunk.stylesheetFilePaths) {
    for (const sourceFilePath of input.chunk.sourceFilePaths) {
      pushAvailabilityRecord({
        availability: input.availability,
        availabilityKeys: input.availabilityKeys,
        entry: input.entry,
        chunk: input.chunk,
        bundlerProfile: input.bundlerProfile,
        stylesheetFilePath,
        sourceFilePath,
        availabilityState: input.availabilityState,
        reason: input.reason,
      });
    }
  }
}

function pushDynamicCssImportAvailabilityRecords(input: {
  availability: RuntimeCssAvailability[];
  availabilityKeys: Set<string>;
  entry: RuntimeCssEntry;
  chunk: RuntimeCssChunk;
  bundlerProfile: RuntimeCssBundlerProfile;
  sourceDynamicallyImportedStylesheetsBySourcePath: Map<string, string[]>;
}): void {
  for (const sourceFilePath of input.chunk.sourceFilePaths) {
    for (const stylesheetFilePath of input.sourceDynamicallyImportedStylesheetsBySourcePath.get(
      sourceFilePath,
    ) ?? []) {
      pushAvailabilityRecord({
        availability: input.availability,
        availabilityKeys: input.availabilityKeys,
        entry: input.entry,
        chunk: input.chunk,
        bundlerProfile: input.bundlerProfile,
        stylesheetFilePath,
        sourceFilePath,
        availabilityState: "possible",
        reason: "stylesheet may be loaded by a dynamic CSS import",
      });
    }
  }
}

function pushUnresolvedDynamicImportAvailabilityRecords(input: {
  availability: RuntimeCssAvailability[];
  availabilityKeys: Set<string>;
  entry: RuntimeCssEntry;
  chunk: RuntimeCssChunk;
  bundlerProfile: RuntimeCssBundlerProfile;
  stylesheetFilePaths: string[];
  unresolvedDynamicImportSpecifiersBySourcePath: Map<string, string[]>;
}): void {
  if (input.stylesheetFilePaths.length === 0) {
    return;
  }

  const hasUnresolvedDynamicImport = input.chunk.sourceFilePaths.some(
    (sourceFilePath) =>
      (input.unresolvedDynamicImportSpecifiersBySourcePath.get(sourceFilePath) ?? []).length > 0,
  );
  if (!hasUnresolvedDynamicImport) {
    return;
  }

  for (const sourceFilePath of input.chunk.sourceFilePaths) {
    for (const stylesheetFilePath of input.stylesheetFilePaths) {
      pushAvailabilityRecord({
        availability: input.availability,
        availabilityKeys: input.availabilityKeys,
        entry: input.entry,
        chunk: input.chunk,
        bundlerProfile: input.bundlerProfile,
        stylesheetFilePath,
        sourceFilePath,
        availabilityState: "possible",
        reason: "stylesheet may be loaded by an unresolved dynamic import",
      });
    }
  }
}

function pushGenericBundlerPossibleAvailabilityRecords(input: {
  availability: RuntimeCssAvailability[];
  availabilityKeys: Set<string>;
  entries: RuntimeCssEntry[];
  chunks: RuntimeCssChunk[];
  bundlerProfile: RuntimeCssBundlerProfile;
}): void {
  for (const entry of input.entries) {
    const entryChunks = input.chunks.filter((chunk) => chunk.entryId === entry.id);
    const entrySourceFilePaths = [
      ...new Set(entryChunks.flatMap((chunk) => chunk.sourceFilePaths)),
    ].sort((left, right) => left.localeCompare(right));
    const entryStylesheetFilePaths = [
      ...new Set(entryChunks.flatMap((chunk) => chunk.stylesheetFilePaths)),
    ].sort((left, right) => left.localeCompare(right));

    for (const chunk of entryChunks) {
      for (const sourceFilePath of entrySourceFilePaths) {
        for (const stylesheetFilePath of entryStylesheetFilePaths) {
          pushAvailabilityRecord({
            availability: input.availability,
            availabilityKeys: input.availabilityKeys,
            entry,
            chunk,
            bundlerProfile: input.bundlerProfile,
            stylesheetFilePath,
            sourceFilePath,
            availabilityState: "possible",
            reason: "stylesheet may be loaded because bundler CSS chunk behavior is unknown",
          });
        }
      }
    }
  }
}

function pushAvailabilityRecord(input: {
  availability: RuntimeCssAvailability[];
  availabilityKeys: Set<string>;
  entry: RuntimeCssEntry;
  chunk: RuntimeCssChunk;
  bundlerProfile: RuntimeCssBundlerProfile;
  stylesheetFilePath: string;
  sourceFilePath: string;
  availabilityState: RuntimeCssAvailability["availability"];
  reason: RuntimeCssAvailability["reason"];
}): void {
  const record: RuntimeCssAvailability = {
    stylesheetFilePath: input.stylesheetFilePath,
    sourceFilePath: input.sourceFilePath,
    availability: input.availabilityState,
    entryId: input.entry.id,
    chunkId: input.chunk.id,
    entrySourceFilePath: input.entry.entrySourceFilePath,
    ...(input.entry.htmlFilePath ? { htmlFilePath: input.entry.htmlFilePath } : {}),
    bundlerProfileId: input.bundlerProfile.id,
    bundler: input.bundlerProfile.bundler,
    cssLoading: input.bundlerProfile.cssLoading,
    confidence: input.bundlerProfile.confidence,
    reason: input.reason,
  };
  const key = [
    record.stylesheetFilePath,
    record.sourceFilePath,
    record.entryId,
    record.chunkId,
    record.availability,
    record.reason,
  ].join("\0");
  if (input.availabilityKeys.has(key)) {
    return;
  }
  input.availabilityKeys.add(key);
  input.availability.push(record);
}

function compareRuntimeCssEntries(left: RuntimeCssEntry, right: RuntimeCssEntry): number {
  return left.id.localeCompare(right.id);
}

function compareRuntimeCssChunks(left: RuntimeCssChunk, right: RuntimeCssChunk): number {
  return left.id.localeCompare(right.id);
}

function compareRuntimeCssAvailability(
  left: RuntimeCssAvailability,
  right: RuntimeCssAvailability,
): number {
  return (
    left.stylesheetFilePath.localeCompare(right.stylesheetFilePath) ||
    left.sourceFilePath.localeCompare(right.sourceFilePath) ||
    left.entryId.localeCompare(right.entryId) ||
    left.chunkId.localeCompare(right.chunkId) ||
    left.entrySourceFilePath.localeCompare(right.entrySourceFilePath) ||
    (left.htmlFilePath ?? "").localeCompare(right.htmlFilePath ?? "") ||
    left.availability.localeCompare(right.availability) ||
    left.reason.localeCompare(right.reason)
  );
}

function runtimeCssEntryId(input: {
  kind: RuntimeCssEntry["kind"];
  entrySourceFilePath: string;
  htmlFilePath?: string;
}): string {
  return [
    "runtime-css-entry",
    input.kind,
    normalizeProjectPath(input.entrySourceFilePath),
    input.htmlFilePath ? normalizeProjectPath(input.htmlFilePath) : "",
  ].join(":");
}

function runtimeCssChunkId(input: {
  entryId: string;
  loading: RuntimeCssChunk["loading"];
  rootSourceFilePath: string;
}): string {
  return [
    "runtime-css-chunk",
    input.entryId,
    input.loading,
    normalizeProjectPath(input.rootSourceFilePath),
  ].join(":");
}
