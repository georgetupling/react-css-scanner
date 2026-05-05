import type { FactGraphResult } from "../fact-graph/index.js";
import type { ProjectResourceEdge } from "../workspace-discovery/index.js";
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

  const appEntries = collectAppEntries({
    snapshotEdges: input.factGraph.snapshot.edges,
    moduleFilePaths,
  });
  const bundlerProfiles = detectRuntimeCssBundlerProfiles({
    bundlerConfigFiles: input.factGraph.snapshot.files.bundlerConfigFiles,
  });
  const selectedBundlerProfile = selectRuntimeCssBundlerProfile(bundlerProfiles);
  const runtimeCssMode = selectedBundlerProfile.cssLoading;
  const entries = appEntries.map(createRuntimeCssEntry).sort(compareRuntimeCssEntries);
  const chunks: RuntimeCssChunk[] = [];
  const chunkKeys = new Set<string>();
  const availability: RuntimeCssAvailability[] = [];
  const availabilityKeys = new Set<string>();

  for (const entry of entries) {
    const initialSourceFilePaths = collectReachableSourceFilePaths({
      entrySourceFilePath: entry.entrySourceFilePath,
      importedSourcePathsBySourcePath,
      moduleFilePaths,
    });
    const initialStylesheetPaths = collectBundleStylesheetPaths({
      sourceFilePaths: initialSourceFilePaths,
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
    pushUniqueChunk(chunks, chunkKeys, initialChunk);
    pushAvailabilityRecords({
      availability,
      availabilityKeys,
      entry,
      chunk: initialChunk,
      bundlerProfile: selectedBundlerProfile,
      availabilityState: "definite",
      reason: "stylesheet is loaded by the same HTML app entry bundle",
    });
    pushDynamicCssImportAvailabilityRecords({
      availability,
      availabilityKeys,
      entry,
      chunk: initialChunk,
      bundlerProfile: selectedBundlerProfile,
      sourceDynamicallyImportedStylesheetsBySourcePath,
    });
    pushUnresolvedDynamicImportAvailabilityRecords({
      availability,
      availabilityKeys,
      entry,
      chunk: initialChunk,
      bundlerProfile: selectedBundlerProfile,
      stylesheetFilePaths: graph.nodes.stylesheets
        .map((stylesheet) => stylesheet.filePath)
        .filter((filePath): filePath is string => Boolean(filePath))
        .map(normalizeProjectPath),
      unresolvedDynamicImportSpecifiersBySourcePath,
    });

    if (runtimeCssMode === "single-initial-stylesheet") {
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
      pushAvailabilityRecords({
        availability,
        availabilityKeys,
        entry,
        chunk: expandedInitialChunk,
        bundlerProfile: selectedBundlerProfile,
        availabilityState: "definite",
        reason: "stylesheet is loaded by the same HTML app entry bundle",
      });
      pushDynamicCssImportAvailabilityRecords({
        availability,
        availabilityKeys,
        entry,
        chunk: expandedInitialChunk,
        bundlerProfile: selectedBundlerProfile,
        sourceDynamicallyImportedStylesheetsBySourcePath,
      });
      pushUnresolvedDynamicImportAvailabilityRecords({
        availability,
        availabilityKeys,
        entry,
        chunk: expandedInitialChunk,
        bundlerProfile: selectedBundlerProfile,
        stylesheetFilePaths: graph.nodes.stylesheets
          .map((stylesheet) => stylesheet.filePath)
          .filter((filePath): filePath is string => Boolean(filePath))
          .map(normalizeProjectPath),
        unresolvedDynamicImportSpecifiersBySourcePath,
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
      pushUniqueChunk(chunks, chunkKeys, lazyChunk);
      pushAvailabilityRecords({
        availability,
        availabilityKeys,
        entry,
        chunk: lazyChunk,
        bundlerProfile: selectedBundlerProfile,
        availabilityState: "definite",
        reason: "stylesheet is loaded by the same lazy runtime CSS chunk",
      });
      pushDynamicCssImportAvailabilityRecords({
        availability,
        availabilityKeys,
        entry,
        chunk: lazyChunk,
        bundlerProfile: selectedBundlerProfile,
        sourceDynamicallyImportedStylesheetsBySourcePath,
      });
      pushUnresolvedDynamicImportAvailabilityRecords({
        availability,
        availabilityKeys,
        entry,
        chunk: lazyChunk,
        bundlerProfile: selectedBundlerProfile,
        stylesheetFilePaths: graph.nodes.stylesheets
          .map((stylesheet) => stylesheet.filePath)
          .filter((filePath): filePath is string => Boolean(filePath))
          .map(normalizeProjectPath),
        unresolvedDynamicImportSpecifiersBySourcePath,
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

  if (runtimeCssMode === "generic-esm-chunks") {
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

function collectAppEntries(input: {
  snapshotEdges: ProjectResourceEdge[];
  moduleFilePaths: string[];
}): Array<{
  kind: RuntimeCssEntry["kind"];
  entrySourceFilePath: string;
  htmlFilePath?: string;
  confidence: RuntimeCssEntry["confidence"];
  reason: string;
}> {
  const htmlEntryEdges = input.snapshotEdges
    .filter(
      (
        edge,
      ): edge is ProjectResourceEdge & {
        kind: "html-script";
        resolvedFilePath: string;
      } => edge.kind === "html-script" && Boolean(edge.resolvedFilePath),
    )
    .map((edge) => ({
      kind: "html-entry" as const,
      htmlFilePath: normalizeProjectPath(edge.fromHtmlFilePath),
      entrySourceFilePath: normalizeProjectPath(edge.resolvedFilePath),
      confidence: "high" as const,
      reason: "HTML module script resolved to an analyzed source entry",
    }))
    .sort(
      (left, right) =>
        left.htmlFilePath.localeCompare(right.htmlFilePath) ||
        left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
    );
  const moduleFilePathSet = new Set(input.moduleFilePaths);
  const validHtmlEntryEdges = htmlEntryEdges.filter((entry) =>
    moduleFilePathSet.has(entry.entrySourceFilePath),
  );
  return validHtmlEntryEdges.length > 0
    ? validHtmlEntryEdges
    : collectConventionalEntrySourceFilePaths(input.moduleFilePaths).map((entrySourceFilePath) => ({
        kind: "conventional-entry",
        entrySourceFilePath,
        confidence: "medium",
        reason: "No valid HTML module script entry resolved; inferred conventional main module",
      }));
}

function collectConventionalEntrySourceFilePaths(moduleFilePaths: string[]): string[] {
  const entryFileNames = new Set(["main.jsx", "main.js", "main.ts", "main.tsx"]);
  return moduleFilePaths
    .filter((filePath) => entryFileNames.has(getBaseName(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}

function collectReachableSourceFilePaths(input: {
  entrySourceFilePath: string;
  importedSourcePathsBySourcePath: Map<string, string[]>;
  moduleFilePaths: string[];
}): string[] {
  const moduleFilePaths = new Set(input.moduleFilePaths);
  const reachable = new Set<string>();
  const queue = [input.entrySourceFilePath];
  const queued = new Set(queue);

  while (queue.length > 0) {
    const sourceFilePath = queue.shift();
    if (!sourceFilePath) {
      continue;
    }
    queued.delete(sourceFilePath);
    if (!moduleFilePaths.has(sourceFilePath) || reachable.has(sourceFilePath)) {
      continue;
    }
    reachable.add(sourceFilePath);

    const importedSourcePaths = (input.importedSourcePathsBySourcePath.get(sourceFilePath) ?? [])
      .slice()
      .sort((left, right) => left.localeCompare(right));
    for (const importedSourcePath of importedSourcePaths) {
      if (reachable.has(importedSourcePath) || queued.has(importedSourcePath)) {
        continue;
      }
      queue.push(importedSourcePath);
      queued.add(importedSourcePath);
    }
  }

  return [...reachable].sort((left, right) => left.localeCompare(right));
}

function collectReachableRuntimeSourceFilePaths(input: {
  entrySourceFilePath: string;
  staticImportedSourcePathsBySourcePath: Map<string, string[]>;
  dynamicallyImportedSourcePathsBySourcePath: Map<string, string[]>;
  moduleFilePaths: string[];
}): string[] {
  const mergedImportedSourcePathsBySourcePath = new Map<string, string[]>();
  for (const [sourceFilePath, importedSourcePaths] of input.staticImportedSourcePathsBySourcePath) {
    for (const importedSourcePath of importedSourcePaths) {
      pushMapValue(mergedImportedSourcePathsBySourcePath, sourceFilePath, importedSourcePath);
    }
  }
  for (const [
    sourceFilePath,
    importedSourcePaths,
  ] of input.dynamicallyImportedSourcePathsBySourcePath) {
    for (const importedSourcePath of importedSourcePaths) {
      pushMapValue(mergedImportedSourcePathsBySourcePath, sourceFilePath, importedSourcePath);
    }
  }

  return collectReachableSourceFilePaths({
    entrySourceFilePath: input.entrySourceFilePath,
    importedSourcePathsBySourcePath: mergedImportedSourcePathsBySourcePath,
    moduleFilePaths: input.moduleFilePaths,
  });
}

function collectBundleStylesheetPaths(input: {
  sourceFilePaths: string[];
  sourceImportedStylesheetsBySourcePath: Map<string, string[]>;
  importedStylesheetPathsByStylesheetPath: Map<string, string[]>;
}): string[] {
  const stylesheetPaths = new Set<string>();
  const queue: string[] = [];
  const queued = new Set<string>();

  for (const sourceFilePath of input.sourceFilePaths) {
    for (const stylesheetPath of input.sourceImportedStylesheetsBySourcePath.get(sourceFilePath) ??
      []) {
      if (stylesheetPaths.has(stylesheetPath) || queued.has(stylesheetPath)) {
        continue;
      }
      queue.push(stylesheetPath);
      queued.add(stylesheetPath);
    }
  }

  while (queue.length > 0) {
    const stylesheetPath = queue.shift();
    if (!stylesheetPath) {
      continue;
    }
    queued.delete(stylesheetPath);
    if (stylesheetPaths.has(stylesheetPath)) {
      continue;
    }
    stylesheetPaths.add(stylesheetPath);

    const importedStylesheetPaths = (
      input.importedStylesheetPathsByStylesheetPath.get(stylesheetPath) ?? []
    )
      .slice()
      .sort((left, right) => left.localeCompare(right));
    for (const importedStylesheetPath of importedStylesheetPaths) {
      if (stylesheetPaths.has(importedStylesheetPath) || queued.has(importedStylesheetPath)) {
        continue;
      }
      queue.push(importedStylesheetPath);
      queued.add(importedStylesheetPath);
    }
  }

  return [...stylesheetPaths].sort((left, right) => left.localeCompare(right));
}

function enqueueDynamicImportTargets(input: {
  sourceFilePaths: string[];
  dynamicallyImportedSourcePathsBySourcePath: Map<string, string[]>;
  excludedSourceFilePaths: Set<string>;
  queue: string[];
  queued: Set<string>;
  processed: Set<string>;
}): void {
  for (const sourceFilePath of input.sourceFilePaths) {
    const dynamicSourceFilePaths = (
      input.dynamicallyImportedSourcePathsBySourcePath.get(sourceFilePath) ?? []
    )
      .slice()
      .sort((left, right) => left.localeCompare(right));

    for (const dynamicSourceFilePath of dynamicSourceFilePaths) {
      if (
        input.excludedSourceFilePaths.has(dynamicSourceFilePath) ||
        input.processed.has(dynamicSourceFilePath) ||
        input.queued.has(dynamicSourceFilePath)
      ) {
        continue;
      }
      input.queue.push(dynamicSourceFilePath);
      input.queued.add(dynamicSourceFilePath);
    }
  }
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
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

function detectRuntimeCssBundlerProfiles(input: {
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
}): RuntimeCssBundlerProfile[] {
  const profiles: RuntimeCssBundlerProfile[] = [];
  for (const configFile of input.bundlerConfigFiles) {
    if (configFile.bundler !== "vite") {
      continue;
    }

    const cssCodeSplitFalse = /\bcssCodeSplit\s*:\s*false\b/.test(configFile.sourceText);
    profiles.push({
      id: `runtime-css-bundler:vite:${normalizeProjectPath(configFile.filePath)}`,
      bundler: "vite",
      cssLoading: cssCodeSplitFalse ? "single-initial-stylesheet" : "split-by-runtime-chunk",
      confidence: cssCodeSplitFalse ? "high" : "medium",
      evidence: [normalizeProjectPath(configFile.filePath)],
      reason: cssCodeSplitFalse
        ? "Vite config sets build.cssCodeSplit to false"
        : "Vite config detected; assuming Vite default CSS code splitting",
    });
  }

  if (profiles.length > 0) {
    return profiles.sort(compareRuntimeCssBundlerProfiles);
  }

  return [
    {
      id: "runtime-css-bundler:unknown",
      bundler: "unknown",
      cssLoading: "generic-esm-chunks",
      confidence: "medium",
      evidence: [],
      reason: "No supported bundler config detected; using generic ESM runtime chunk semantics",
    },
  ];
}

function selectRuntimeCssBundlerProfile(
  profiles: RuntimeCssBundlerProfile[],
): RuntimeCssBundlerProfile {
  const singleInitialProfile = profiles.find(
    (profile) => profile.cssLoading === "single-initial-stylesheet",
  );
  if (singleInitialProfile) {
    return singleInitialProfile;
  }
  const splitProfile = profiles.find((profile) => profile.cssLoading === "split-by-runtime-chunk");
  if (splitProfile) {
    return splitProfile;
  }
  return profiles[0];
}

function compareRuntimeCssBundlerProfiles(
  left: RuntimeCssBundlerProfile,
  right: RuntimeCssBundlerProfile,
): number {
  return left.id.localeCompare(right.id);
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

function normalizeProjectPath(filePath: string): string {
  return filePath
    .split("\\")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function getBaseName(filePath: string): string {
  return normalizeProjectPath(filePath).split("/").at(-1) ?? filePath;
}
