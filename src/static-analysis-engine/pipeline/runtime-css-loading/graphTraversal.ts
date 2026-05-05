import { pushMapValue } from "./mapUtils.js";

export function collectReachableSourceFilePaths(input: {
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

export function collectReachableRuntimeSourceFilePaths(input: {
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

export function collectBundleStylesheetPaths(input: {
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

export function enqueueDynamicImportTargets(input: {
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
