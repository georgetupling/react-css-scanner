import ts from "typescript";

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
  const runtimeCssMode = selectedBundlerProfile.cssLoading;
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
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  packageJsonFiles: FactGraphResult["snapshot"]["files"]["packageJsonFiles"];
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
  const viteInputEntries = collectViteInputEntries({
    bundlerConfigFiles: input.bundlerConfigFiles,
    htmlEntries: htmlEntryEdges,
    moduleFilePathSet,
  });
  if (viteInputEntries.length > 0) {
    return viteInputEntries;
  }
  const webpackEntries = collectWebpackEntries({
    bundlerConfigFiles: input.bundlerConfigFiles,
    moduleFilePathSet,
  });
  if (webpackEntries.length > 0) {
    return webpackEntries;
  }
  const nextEntries = collectNextEntries({
    bundlerConfigFiles: input.bundlerConfigFiles,
    packageJsonFiles: input.packageJsonFiles,
    moduleFilePaths: input.moduleFilePaths,
  });
  if (nextEntries.length > 0) {
    return nextEntries;
  }

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

function collectWebpackEntries(input: {
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  moduleFilePathSet: ReadonlySet<string>;
}): Array<{
  kind: RuntimeCssEntry["kind"];
  entrySourceFilePath: string;
  confidence: RuntimeCssEntry["confidence"];
  reason: string;
}> {
  const entries: Array<{
    kind: RuntimeCssEntry["kind"];
    entrySourceFilePath: string;
    confidence: RuntimeCssEntry["confidence"];
    reason: string;
  }> = [];
  const entryPaths = new Set<string>();

  for (const configFile of input.bundlerConfigFiles) {
    if (configFile.bundler !== "webpack") {
      continue;
    }
    for (const entryPath of extractWebpackEntryPaths(configFile.sourceText)) {
      const normalizedEntryPath = normalizeProjectPath(entryPath);
      if (
        !input.moduleFilePathSet.has(normalizedEntryPath) ||
        entryPaths.has(normalizedEntryPath)
      ) {
        continue;
      }
      entryPaths.add(normalizedEntryPath);
      entries.push({
        kind: "webpack-entry",
        entrySourceFilePath: normalizedEntryPath,
        confidence: "high",
        reason: `Webpack config entry ${normalizedEntryPath} resolved to an analyzed source entry`,
      });
    }
  }

  return entries.sort((left, right) =>
    left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
  );
}

function collectNextEntries(input: {
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  packageJsonFiles: FactGraphResult["snapshot"]["files"]["packageJsonFiles"];
  moduleFilePaths: string[];
}): Array<{
  kind: RuntimeCssEntry["kind"];
  entrySourceFilePath: string;
  confidence: RuntimeCssEntry["confidence"];
  reason: string;
}> {
  const hasNextEvidence =
    input.bundlerConfigFiles.some((configFile) => configFile.bundler === "next") ||
    input.packageJsonFiles.some(hasNextPackageDependency);
  if (!hasNextEvidence) {
    return [];
  }

  const entries: Array<{
    kind: RuntimeCssEntry["kind"];
    entrySourceFilePath: string;
    confidence: RuntimeCssEntry["confidence"];
    reason: string;
  }> = [];
  const moduleFilePathSet = new Set(input.moduleFilePaths);
  for (const candidatePath of [
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    "app/layout.tsx",
    "app/layout.jsx",
  ]) {
    if (!moduleFilePathSet.has(candidatePath)) {
      continue;
    }
    entries.push({
      kind: "next-app-entry",
      entrySourceFilePath: candidatePath,
      confidence: "medium",
      reason: "Next app-router root layout inferred as the global CSS runtime entry",
    });
  }
  for (const candidatePath of [
    "src/pages/_app.tsx",
    "src/pages/_app.jsx",
    "pages/_app.tsx",
    "pages/_app.jsx",
  ]) {
    if (!moduleFilePathSet.has(candidatePath)) {
      continue;
    }
    entries.push({
      kind: "next-pages-entry",
      entrySourceFilePath: candidatePath,
      confidence: "medium",
      reason: "Next pages-router _app inferred as the global CSS runtime entry",
    });
  }

  return entries.sort((left, right) =>
    left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
  );
}

function collectViteInputEntries(input: {
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  htmlEntries: Array<{
    kind: "html-entry";
    htmlFilePath: string;
    entrySourceFilePath: string;
    confidence: "high";
    reason: string;
  }>;
  moduleFilePathSet: ReadonlySet<string>;
}): Array<{
  kind: RuntimeCssEntry["kind"];
  entrySourceFilePath: string;
  htmlFilePath?: string;
  confidence: RuntimeCssEntry["confidence"];
  reason: string;
}> {
  const entries: Array<{
    kind: RuntimeCssEntry["kind"];
    entrySourceFilePath: string;
    htmlFilePath?: string;
    confidence: RuntimeCssEntry["confidence"];
    reason: string;
  }> = [];
  const entryKeys = new Set<string>();

  for (const configFile of input.bundlerConfigFiles) {
    if (configFile.bundler !== "vite") {
      continue;
    }
    for (const inputPath of extractViteRollupInputPaths(configFile.sourceText)) {
      const normalizedInputPath = normalizeProjectPath(inputPath);
      const htmlEntry = input.htmlEntries.find(
        (entry) => entry.htmlFilePath === normalizedInputPath,
      );
      if (htmlEntry && input.moduleFilePathSet.has(htmlEntry.entrySourceFilePath)) {
        const key = `html:${htmlEntry.htmlFilePath}:${htmlEntry.entrySourceFilePath}`;
        if (!entryKeys.has(key)) {
          entryKeys.add(key);
          entries.push({
            ...htmlEntry,
            reason: `Vite rollupOptions.input ${normalizedInputPath} resolved through HTML module script`,
          });
        }
        continue;
      }

      if (input.moduleFilePathSet.has(normalizedInputPath)) {
        const key = `source:${normalizedInputPath}`;
        if (!entryKeys.has(key)) {
          entryKeys.add(key);
          entries.push({
            kind: "vite-input-entry",
            entrySourceFilePath: normalizedInputPath,
            confidence: "high",
            reason: `Vite rollupOptions.input ${normalizedInputPath} resolved to an analyzed source entry`,
          });
        }
      }
    }
  }

  return entries.sort(
    (left, right) =>
      (left.htmlFilePath ?? "").localeCompare(right.htmlFilePath ?? "") ||
      left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
  );
}

function collectConventionalEntrySourceFilePaths(moduleFilePaths: string[]): string[] {
  const entryFileNames = new Set(["main.jsx", "main.js", "main.ts", "main.tsx"]);
  return moduleFilePaths
    .filter((filePath) => entryFileNames.has(getBaseName(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}

function extractViteRollupInputPaths(sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(
    "vite.config.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const inputPaths = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && getPropertyNameText(node.name) === "rollupOptions") {
      collectInputPathsFromRollupOptions(node.initializer, inputPaths);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return [...inputPaths].sort((left, right) => left.localeCompare(right));
}

function extractWebpackEntryPaths(sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(
    "webpack.config.js",
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const entryPaths = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && getPropertyNameText(node.name) === "entry") {
      for (const entryPath of readStaticInputExpressionPaths(node.initializer)) {
        entryPaths.add(entryPath);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return [...entryPaths].sort((left, right) => left.localeCompare(right));
}

function collectInputPathsFromRollupOptions(node: ts.Expression, inputPaths: Set<string>): void {
  const expression = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(expression)) {
    return;
  }

  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || getPropertyNameText(property.name) !== "input") {
      continue;
    }
    for (const inputPath of readStaticInputExpressionPaths(property.initializer)) {
      inputPaths.add(inputPath);
    }
  }
}

function readStaticInputExpressionPaths(node: ts.Expression): string[] {
  const expression = unwrapExpression(node);
  const stringPath = readStaticPathExpression(expression);
  if (stringPath) {
    return [stringPath];
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) => readStaticInputExpressionPaths(element));
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) {
        return [];
      }
      return readStaticInputExpressionPaths(property.initializer);
    });
  }

  return [];
}

function readStaticPathExpression(node: ts.Expression): string | undefined {
  const expression = unwrapExpression(node);
  if (ts.isStringLiteralLike(expression)) {
    return normalizeViteInputPath(expression.text);
  }
  if (ts.isCallExpression(expression)) {
    const stringArguments = expression.arguments
      .filter(ts.isStringLiteralLike)
      .map((argument) => normalizeViteInputPath(argument.text))
      .filter(Boolean);
    return stringArguments.at(-1);
  }
  return undefined;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function normalizeViteInputPath(inputPath: string): string {
  return normalizeProjectPath(inputPath.replace(/^\.\//, "").replace(/^\/+/, ""));
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

function collectNextRuntimeSourceFilePaths(input: {
  entry: RuntimeCssEntry;
  entryBundleSourceFilePaths: string[];
  moduleFilePaths: string[];
}): string[] {
  const sourceFilePaths = new Set(input.entryBundleSourceFilePaths);
  const entryPath = normalizeProjectPath(input.entry.entrySourceFilePath);
  const appRootPrefix = getNextAppRootPrefix(entryPath);
  const pagesRootPrefix = getNextPagesRootPrefix(entryPath);

  for (const moduleFilePath of input.moduleFilePaths) {
    const normalizedModulePath = normalizeProjectPath(moduleFilePath);
    if (
      appRootPrefix &&
      normalizedModulePath.startsWith(appRootPrefix) &&
      isNextAppRouteFile(normalizedModulePath)
    ) {
      sourceFilePaths.add(normalizedModulePath);
      continue;
    }
    if (
      pagesRootPrefix &&
      normalizedModulePath.startsWith(pagesRootPrefix) &&
      isNextPagesRouteFile(normalizedModulePath)
    ) {
      sourceFilePaths.add(normalizedModulePath);
    }
  }

  return [...sourceFilePaths].sort((left, right) => left.localeCompare(right));
}

function isNextEntry(entry: RuntimeCssEntry): boolean {
  return entry.kind === "next-app-entry" || entry.kind === "next-pages-entry";
}

function getNextAppRootPrefix(entrySourceFilePath: string): string | undefined {
  if (entrySourceFilePath === "app/layout.tsx" || entrySourceFilePath === "app/layout.jsx") {
    return "app/";
  }
  if (
    entrySourceFilePath === "src/app/layout.tsx" ||
    entrySourceFilePath === "src/app/layout.jsx"
  ) {
    return "src/app/";
  }
  return undefined;
}

function getNextPagesRootPrefix(entrySourceFilePath: string): string | undefined {
  if (entrySourceFilePath === "pages/_app.tsx" || entrySourceFilePath === "pages/_app.jsx") {
    return "pages/";
  }
  if (
    entrySourceFilePath === "src/pages/_app.tsx" ||
    entrySourceFilePath === "src/pages/_app.jsx"
  ) {
    return "src/pages/";
  }
  return undefined;
}

function isNextAppRouteFile(filePath: string): boolean {
  return /\/(layout|page)\.[jt]sx?$/.test(filePath);
}

function isNextPagesRouteFile(filePath: string): boolean {
  const baseName = getBaseName(filePath);
  if (baseName.startsWith("_") || baseName.startsWith(".")) {
    return false;
  }
  return /\.[jt]sx?$/.test(baseName);
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
  packageJsonFiles: FactGraphResult["snapshot"]["files"]["packageJsonFiles"];
}): RuntimeCssBundlerProfile[] {
  const profiles: RuntimeCssBundlerProfile[] = [];
  for (const configFile of input.bundlerConfigFiles) {
    const normalizedConfigPath = normalizeProjectPath(configFile.filePath);
    if (configFile.bundler === "vite") {
      const cssCodeSplitFalse = /\bcssCodeSplit\s*:\s*false\b/.test(configFile.sourceText);
      profiles.push({
        id: `runtime-css-bundler:vite:${normalizedConfigPath}`,
        bundler: "vite",
        cssLoading: cssCodeSplitFalse ? "single-initial-stylesheet" : "split-by-runtime-chunk",
        confidence: cssCodeSplitFalse ? "high" : "medium",
        evidence: [normalizedConfigPath],
        reason: cssCodeSplitFalse
          ? "Vite config sets build.cssCodeSplit to false"
          : "Vite config detected; assuming Vite default CSS code splitting",
      });
      continue;
    }
    if (configFile.bundler === "webpack") {
      profiles.push({
        id: `runtime-css-bundler:webpack:${normalizedConfigPath}`,
        bundler: "webpack",
        cssLoading: "split-by-runtime-chunk",
        confidence: /MiniCssExtractPlugin|mini-css-extract-plugin/.test(configFile.sourceText)
          ? "high"
          : "medium",
        evidence: [normalizedConfigPath],
        reason: /MiniCssExtractPlugin|mini-css-extract-plugin/.test(configFile.sourceText)
          ? "Webpack config uses MiniCssExtractPlugin; modeling CSS by runtime chunk"
          : "Webpack config detected; modeling CSS with runtime chunk semantics",
      });
      continue;
    }
    if (configFile.bundler === "next") {
      profiles.push({
        id: `runtime-css-bundler:next:${normalizedConfigPath}`,
        bundler: "next",
        cssLoading: "split-by-runtime-chunk",
        confidence: "medium",
        evidence: [normalizedConfigPath],
        reason: "Next config detected; modeling route-aware framework CSS chunks",
      });
      continue;
    }
    if (configFile.bundler === "remix" || configFile.bundler === "astro") {
      profiles.push({
        id: `runtime-css-bundler:${configFile.bundler}:${normalizedConfigPath}`,
        bundler: configFile.bundler,
        cssLoading: "generic-esm-chunks",
        confidence: "medium",
        evidence: [normalizedConfigPath],
        reason: `${formatBundlerName(configFile.bundler)} config detected; using conservative generic runtime chunk semantics`,
      });
    }
  }

  if (profiles.length > 0) {
    return profiles.sort(compareRuntimeCssBundlerProfiles);
  }

  const vitePackageFile = input.packageJsonFiles.find(hasVitePackageDependency);
  if (vitePackageFile) {
    return [
      {
        id: `runtime-css-bundler:vite-package:${normalizeProjectPath(vitePackageFile.filePath)}`,
        bundler: "vite",
        cssLoading: "split-by-runtime-chunk",
        confidence: "medium",
        evidence: [normalizeProjectPath(vitePackageFile.filePath)],
        reason:
          "Vite dependency detected in package metadata; assuming Vite default CSS code splitting",
      },
    ];
  }
  const webpackPackageFile = input.packageJsonFiles.find(hasWebpackPackageDependency);
  if (webpackPackageFile) {
    return [
      {
        id: `runtime-css-bundler:webpack-package:${normalizeProjectPath(webpackPackageFile.filePath)}`,
        bundler: "webpack",
        cssLoading: "split-by-runtime-chunk",
        confidence: "medium",
        evidence: [normalizeProjectPath(webpackPackageFile.filePath)],
        reason:
          "Webpack dependency detected in package metadata; modeling CSS with runtime chunk semantics",
      },
    ];
  }
  const nextPackageFile = input.packageJsonFiles.find(hasNextPackageDependency);
  if (nextPackageFile) {
    return [
      {
        id: `runtime-css-bundler:next-package:${normalizeProjectPath(nextPackageFile.filePath)}`,
        bundler: "next",
        cssLoading: "split-by-runtime-chunk",
        confidence: "medium",
        evidence: [normalizeProjectPath(nextPackageFile.filePath)],
        reason:
          "Next dependency detected in package metadata; modeling route-aware framework CSS chunks",
      },
    ];
  }
  const remixPackageFile = input.packageJsonFiles.find(hasRemixPackageDependency);
  if (remixPackageFile) {
    return [
      {
        id: `runtime-css-bundler:remix-package:${normalizeProjectPath(remixPackageFile.filePath)}`,
        bundler: "remix",
        cssLoading: "generic-esm-chunks",
        confidence: "medium",
        evidence: [normalizeProjectPath(remixPackageFile.filePath)],
        reason:
          "Remix dependency detected in package metadata; using conservative generic runtime chunk semantics",
      },
    ];
  }
  const astroPackageFile = input.packageJsonFiles.find(hasAstroPackageDependency);
  if (astroPackageFile) {
    return [
      {
        id: `runtime-css-bundler:astro-package:${normalizeProjectPath(astroPackageFile.filePath)}`,
        bundler: "astro",
        cssLoading: "generic-esm-chunks",
        confidence: "medium",
        evidence: [normalizeProjectPath(astroPackageFile.filePath)],
        reason:
          "Astro dependency detected in package metadata; using conservative generic runtime chunk semantics",
      },
    ];
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

function hasVitePackageDependency(
  packageJsonFile: FactGraphResult["snapshot"]["files"]["packageJsonFiles"][number],
): boolean {
  return hasPackageDependency(packageJsonFile, "vite");
}

function hasWebpackPackageDependency(
  packageJsonFile: FactGraphResult["snapshot"]["files"]["packageJsonFiles"][number],
): boolean {
  return hasPackageDependency(packageJsonFile, "webpack");
}

function hasNextPackageDependency(
  packageJsonFile: FactGraphResult["snapshot"]["files"]["packageJsonFiles"][number],
): boolean {
  return hasPackageDependency(packageJsonFile, "next");
}

function hasRemixPackageDependency(
  packageJsonFile: FactGraphResult["snapshot"]["files"]["packageJsonFiles"][number],
): boolean {
  return Object.keys({
    ...packageJsonFile.dependencies,
    ...packageJsonFile.devDependencies,
    ...packageJsonFile.peerDependencies,
  }).some(
    (packageName) => packageName === "@remix-run/react" || packageName.startsWith("@remix-run/"),
  );
}

function hasAstroPackageDependency(
  packageJsonFile: FactGraphResult["snapshot"]["files"]["packageJsonFiles"][number],
): boolean {
  return hasPackageDependency(packageJsonFile, "astro");
}

function hasPackageDependency(
  packageJsonFile: FactGraphResult["snapshot"]["files"]["packageJsonFiles"][number],
  packageName: string,
): boolean {
  return Boolean(
    packageJsonFile.dependencies[packageName] ??
    packageJsonFile.devDependencies[packageName] ??
    packageJsonFile.peerDependencies[packageName],
  );
}

function formatBundlerName(bundler: RuntimeCssBundlerProfile["bundler"]): string {
  return bundler.slice(0, 1).toUpperCase() + bundler.slice(1);
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
