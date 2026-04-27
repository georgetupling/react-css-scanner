import path from "node:path";
import ts from "typescript";

import { normalizeFilePath } from "./pathUtils.js";
import type { ProjectResolutionTypescriptResolution } from "./types.js";

export function buildTypescriptResolution(input: {
  projectRoot?: string;
  filePaths: Iterable<string>;
  compilerOptions?: ts.CompilerOptions;
}): ProjectResolutionTypescriptResolution | undefined {
  if (!input.projectRoot && !input.compilerOptions) {
    return undefined;
  }

  const projectRoot = normalizeFilePath(path.resolve(input.projectRoot ?? process.cwd()));
  const knownFilePathsByAbsolutePath = new Map<string, string>();
  const knownDirectoryPaths = new Set<string>();

  for (const filePath of input.filePaths) {
    const normalizedFilePath = normalizeFilePath(filePath);
    const absoluteFilePath = normalizeAbsolutePath(path.resolve(projectRoot, normalizedFilePath));
    knownFilePathsByAbsolutePath.set(absoluteFilePath, normalizedFilePath);
    collectKnownDirectoryPaths(path.posix.dirname(absoluteFilePath), knownDirectoryPaths);
  }

  const compilerOptions = normalizeCompilerOptions({
    projectRoot,
    compilerOptions: input.compilerOptions ?? loadCompilerOptionsFromProjectRoot(projectRoot) ?? {},
  });
  const moduleResolutionHost = createModuleResolutionHost({
    knownFilePathsByAbsolutePath,
    knownDirectoryPaths,
  });

  return {
    projectRoot,
    compilerOptions,
    moduleResolutionHost,
    knownFilePathsByAbsolutePath,
  };
}

export function resolveTypescriptModuleSpecifier(input: {
  typescriptResolution: ProjectResolutionTypescriptResolution;
  fromFilePath: string;
  specifier: string;
}): string | undefined {
  const containingFile = normalizeAbsolutePath(
    path.resolve(input.typescriptResolution.projectRoot, normalizeFilePath(input.fromFilePath)),
  );
  const resolvedModule = ts.resolveModuleName(
    input.specifier,
    containingFile,
    input.typescriptResolution.compilerOptions,
    input.typescriptResolution.moduleResolutionHost,
  ).resolvedModule;
  if (!resolvedModule) {
    return undefined;
  }

  return input.typescriptResolution.knownFilePathsByAbsolutePath.get(
    normalizeAbsolutePath(resolvedModule.resolvedFileName),
  );
}

function loadCompilerOptionsFromProjectRoot(projectRoot: string): ts.CompilerOptions | undefined {
  const tsconfigPath = path.resolve(projectRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return undefined;
  }

  return ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot).options;
}

function normalizeCompilerOptions(input: {
  projectRoot: string;
  compilerOptions: ts.CompilerOptions;
}): ts.CompilerOptions {
  if (!input.compilerOptions.baseUrl) {
    return input.compilerOptions;
  }

  return {
    ...input.compilerOptions,
    baseUrl: path.isAbsolute(input.compilerOptions.baseUrl)
      ? input.compilerOptions.baseUrl
      : path.resolve(input.projectRoot, input.compilerOptions.baseUrl),
  };
}

function createModuleResolutionHost(input: {
  knownFilePathsByAbsolutePath: ReadonlyMap<string, string>;
  knownDirectoryPaths: ReadonlySet<string>;
}): ts.ModuleResolutionHost {
  return {
    fileExists: (filePath) =>
      input.knownFilePathsByAbsolutePath.has(normalizeAbsolutePath(filePath)) ||
      ts.sys.fileExists(filePath),
    readFile: (filePath) => ts.sys.readFile(filePath),
    directoryExists: (directoryPath) =>
      input.knownDirectoryPaths.has(normalizeAbsolutePath(directoryPath)) ||
      (ts.sys.directoryExists?.(directoryPath) ?? false),
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    realpath: (filePath) => normalizeAbsolutePath(ts.sys.realpath?.(filePath) ?? filePath),
    getDirectories: (directoryPath) => ts.sys.getDirectories?.(directoryPath) ?? [],
  };
}

function collectKnownDirectoryPaths(directoryPath: string, knownDirectoryPaths: Set<string>): void {
  let currentPath = directoryPath;
  while (currentPath && currentPath !== ".") {
    if (knownDirectoryPaths.has(currentPath)) {
      return;
    }

    knownDirectoryPaths.add(currentPath);
    const parentPath = path.posix.dirname(currentPath);
    if (parentPath === currentPath) {
      return;
    }

    currentPath = parentPath;
  }
}

function normalizeAbsolutePath(filePath: string): string {
  return normalizeFilePath(path.resolve(filePath));
}
