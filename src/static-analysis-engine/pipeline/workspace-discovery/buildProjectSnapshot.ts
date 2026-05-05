import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { ResolvedScannerConfig } from "../../../config/index.js";
import type { DiscoveryConfig } from "../../../config/index.js";
import { loadScannerConfig } from "../../../config/index.js";
import { normalizeProjectPath, resolveRootDir } from "../../../project/pathUtils.js";
import type {
  ProjectFileRecord,
  ScanDiagnostic,
  ScanProjectInput,
} from "../../../project/types.js";
import { collectProjectBoundaries } from "./boundaries/collectProjectBoundaries.js";
import { collectProjectResourceEdges } from "./edges/collectResourceEdges.js";
import { discoverProjectFileRecords } from "./files/discoverProjectFileRecords.js";
import { readCssFiles, readHtmlFiles, readSourceFiles } from "./files/readProjectFileContents.js";
import { mergeStylesheets, toCssSources, toStylesheetFiles } from "./files/stylesheetInventory.js";
import { collectHtmlResources } from "./html/htmlLinks.js";
import { collectLinkedCssFiles } from "./html/htmlPathResolution.js";
import { loadPackageCssImports } from "./packages/loadPackageCssImports.js";
import { fetchRemoteCssSources } from "./remote/fetchRemoteCssSources.js";
import { collectSourceImports } from "./source/collectSourceImports.js";
import { collectStylesheetImports } from "./stylesheets/collectStylesheetImports.js";
import type {
  ProjectBundlerConfigFile,
  ProjectConfigFile,
  ProjectPackageJsonFile,
  ProjectSnapshot,
} from "./types.js";

const IGNORED_DISCOVERY_DIRECTORIES = new Set([
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export async function buildProjectSnapshot(input: {
  scanInput: ScanProjectInput;
  rootDir?: string;
}): Promise<ProjectSnapshot> {
  const rootDir = resolveRootDir(input.rootDir ?? input.scanInput.rootDir);
  const diagnostics: ScanDiagnostic[] = [];
  const config = await loadScannerConfig({
    rootDir,
    configBaseDir: input.scanInput.configBaseDir,
    configPath: input.scanInput.configPath,
    diagnostics,
  });
  const discovery = await buildEffectiveDiscoveryConfig({
    rootDir,
    discovery: config.discovery,
    diagnostics,
  });
  const discovered = await discoverProjectFileRecords({
    ...input.scanInput,
    rootDir,
    discovery,
  });
  diagnostics.push(...discovered.diagnostics);
  const knownDiscoveredStylesheetFilePaths = new Set(
    discovered.cssFiles.map((cssFile) => cssFile.filePath),
  );

  const [sourceFiles, cssFiles, htmlFiles] = await Promise.all([
    readSourceFiles(discovered.sourceFiles, diagnostics),
    readCssFiles(discovered.cssFiles, diagnostics, "project", {
      rootDir: discovered.rootDir,
      knownStylesheetFilePaths: knownDiscoveredStylesheetFilePaths,
      discovery,
    }),
    readHtmlFiles(discovered.htmlFiles, diagnostics),
  ]);
  const bundlerConfigFiles = hasRootDiscoveryError(discovered.diagnostics)
    ? []
    : await collectBundlerConfigFiles({
        rootDir: discovered.rootDir,
        diagnostics,
      });
  const packageJsonFiles = hasRootDiscoveryError(discovered.diagnostics)
    ? []
    : await collectRootPackageJsonFiles({
        rootDir: discovered.rootDir,
        diagnostics,
      });
  const { htmlStylesheetLinks, htmlScriptSources } = collectHtmlResources({
    rootDir: discovered.rootDir,
    htmlFiles,
    knownStylesheetFilePaths: discovered.cssFiles.map((cssFile) => cssFile.filePath),
    discovery,
    diagnostics,
  });
  const linkedCssFiles = await readCssFiles(
    collectLinkedCssFiles({
      rootDir: discovered.rootDir,
      cssFiles: discovered.cssFiles,
      htmlStylesheetLinks,
    }),
    diagnostics,
    "html-linked",
    {
      rootDir: discovered.rootDir,
      knownStylesheetFilePaths: knownDiscoveredStylesheetFilePaths,
      discovery,
    },
  );
  const packageCssImports = await loadPackageCssImports({
    rootDir: discovered.rootDir,
    sourceFiles,
    cssSources: toCssSources([...cssFiles, ...linkedCssFiles]),
    discovery,
    diagnostics,
  });
  const packageStylesheets = toStylesheetFiles(packageCssImports.cssSources, "package");
  const remoteCssSources = config.externalCss.fetchRemote
    ? await fetchRemoteCssSources({
        htmlStylesheetLinks,
        remoteTimeoutMs: config.externalCss.remoteTimeoutMs,
        diagnostics,
      })
    : [];
  const remoteStylesheets = toStylesheetFiles(remoteCssSources, "remote");
  const stylesheets = applyBundlerCssModuleConventions({
    stylesheets: mergeStylesheets([
      ...cssFiles,
      ...linkedCssFiles,
      ...packageStylesheets,
      ...remoteStylesheets,
    ]),
    bundlerConfigFiles,
  });
  const stylesheetImports = collectStylesheetImports({
    stylesheets,
    discovery,
  });
  const sourceImports = collectSourceImports({
    sourceFiles,
    stylesheets,
    discovery,
  });

  return {
    rootDir: discovered.rootDir,
    config,
    files: {
      sourceFiles,
      stylesheets,
      htmlFiles,
      configFiles: collectConfigFiles(config),
      bundlerConfigFiles,
      packageJsonFiles,
    },
    discoveredFiles: {
      sourceFiles: discovered.sourceFiles,
      cssFiles: discovered.cssFiles,
      htmlFiles: discovered.htmlFiles,
    },
    boundaries: collectProjectBoundaries({
      rootDir: discovered.rootDir,
      config,
      htmlScriptSources,
      sourceFiles,
    }),
    edges: collectProjectResourceEdges({
      htmlStylesheetLinks,
      htmlScriptSources,
      packageCssImports: packageCssImports.imports,
      stylesheetImports,
      sourceImports,
    }),
    externalCss: {
      fetchRemote: config.externalCss.fetchRemote,
      globalProviders: config.externalCss.globals,
    },
    diagnostics,
  };
}

function applyBundlerCssModuleConventions(input: {
  stylesheets: ProjectSnapshot["files"]["stylesheets"];
  bundlerConfigFiles: ProjectBundlerConfigFile[];
}): ProjectSnapshot["files"]["stylesheets"] {
  const cssModuleExtensions = inferWebpackCssModuleExtensions(input.bundlerConfigFiles);
  if (cssModuleExtensions.size === 0) {
    return input.stylesheets;
  }

  return input.stylesheets.map((stylesheet) =>
    cssModuleExtensions.has(path.extname(stylesheet.filePath).toLowerCase())
      ? { ...stylesheet, cssKind: "css-module" }
      : stylesheet,
  );
}

function inferWebpackCssModuleExtensions(
  bundlerConfigFiles: ProjectBundlerConfigFile[],
): Set<string> {
  const extensions = new Set<string>();
  for (const configFile of bundlerConfigFiles) {
    if (configFile.bundler !== "webpack") {
      continue;
    }
    collectWebpackCssModuleRuleExtensions(configFile).forEach((extension) =>
      extensions.add(extension),
    );
  }
  return extensions;
}

function collectWebpackCssModuleRuleExtensions(configFile: ProjectBundlerConfigFile): string[] {
  const sourceFile = ts.createSourceFile(
    configFile.filePath,
    configFile.sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const extensions = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && hasDirectProperty(node, "test")) {
      const ruleText = node.getText(sourceFile);
      if (/modules\s*:|modules\s*[,}]/.test(ruleText)) {
        for (const extension of [".css", ".less", ".scss", ".sass"]) {
          const escapedExtension = extension.replace(".", "\\.");
          const extensionPattern = new RegExp(`\\\\${escapedExtension}\\b`);
          if (extensionPattern.test(ruleText)) {
            extensions.add(extension);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return [...extensions].sort((left, right) => left.localeCompare(right));
}

function hasDirectProperty(node: ts.ObjectLiteralExpression, propertyName: string): boolean {
  return node.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) && getPropertyNameText(property.name) === propertyName,
  );
}

function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

async function buildEffectiveDiscoveryConfig(input: {
  rootDir: string;
  discovery: DiscoveryConfig;
  diagnostics: ScanDiagnostic[];
}): Promise<DiscoveryConfig> {
  const inferredAliases = await inferTsconfigAliases({
    rootDir: input.rootDir,
    diagnostics: input.diagnostics,
  });

  return {
    ...input.discovery,
    aliases: mergeAliases(inferredAliases, input.discovery.aliases),
  };
}

async function inferTsconfigAliases(input: {
  rootDir: string;
  diagnostics: ScanDiagnostic[];
}): Promise<Record<string, string[]>> {
  const filePath = "tsconfig.json";
  const absolutePath = path.join(input.rootDir, filePath);
  let sourceText: string;
  try {
    sourceText = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return {};
    }
    input.diagnostics.push({
      code: "loading.tsconfig-read-failed",
      severity: "warning",
      phase: "loading",
      filePath,
      message: `failed to read tsconfig.json for alias inference: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceText);
  } catch (error) {
    input.diagnostics.push({
      code: "loading.tsconfig-parse-failed",
      severity: "warning",
      phase: "loading",
      filePath,
      message: `failed to parse tsconfig.json for alias inference: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return {};
  }

  if (!isRecord(parsed) || !isRecord(parsed.compilerOptions)) {
    return {};
  }

  const compilerOptions = parsed.compilerOptions;
  if (!isRecord(compilerOptions.paths)) {
    return {};
  }

  const baseUrl =
    typeof compilerOptions.baseUrl === "string"
      ? normalizeProjectPath(compilerOptions.baseUrl)
      : ".";
  const aliases: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(compilerOptions.paths).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!Array.isArray(value)) {
      continue;
    }

    const targets = value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => normalizeProjectPath(path.posix.join(baseUrl, entry)));
    if (targets.length > 0) {
      aliases[key] = targets;
    }
  }

  return aliases;
}

function mergeAliases(
  inferredAliases: Record<string, string[]>,
  configuredAliases: Record<string, string[]>,
): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const key of [...Object.keys(inferredAliases), ...Object.keys(configuredAliases)].sort(
    (left, right) => left.localeCompare(right),
  )) {
    aliases[key] = [
      ...new Set([...(configuredAliases[key] ?? []), ...(inferredAliases[key] ?? [])]),
    ];
  }
  return aliases;
}

async function collectRootPackageJsonFiles(input: {
  rootDir: string;
  diagnostics: ScanDiagnostic[];
}): Promise<ProjectPackageJsonFile[]> {
  const filePath = "package.json";
  const absolutePath = path.join(input.rootDir, filePath);
  let sourceText: string;
  try {
    sourceText = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }
    input.diagnostics.push({
      code: "loading.package-json-read-failed",
      severity: "warning",
      phase: "loading",
      filePath,
      message: `failed to read package.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceText);
  } catch (error) {
    input.diagnostics.push({
      code: "loading.package-json-parse-failed",
      severity: "warning",
      phase: "loading",
      filePath,
      message: `failed to parse package.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return [];
  }

  const packageJson = isRecord(parsed) ? parsed : {};
  return [
    {
      kind: "package-json",
      filePath,
      absolutePath,
      ...(typeof packageJson.name === "string" ? { packageName: packageJson.name } : {}),
      dependencies: readStringRecord(packageJson.dependencies),
      devDependencies: readStringRecord(packageJson.devDependencies),
      peerDependencies: readStringRecord(packageJson.peerDependencies),
      scripts: readStringRecord(packageJson.scripts),
      sourceText,
    },
  ];
}

async function collectBundlerConfigFiles(input: {
  rootDir: string;
  diagnostics: ScanDiagnostic[];
}): Promise<ProjectBundlerConfigFile[]> {
  const configFiles = await discoverBundlerConfigFileRecords({
    rootDir: input.rootDir,
    diagnostics: input.diagnostics,
  });
  const configFilePaths = configFiles
    .map((file) => file.filePath)
    .sort((left, right) => left.localeCompare(right));
  const loadedConfigFiles = await Promise.all(
    configFilePaths.map(async (filePath) => {
      const absolutePath = path.join(input.rootDir, filePath);
      const bundler = getRootBundlerConfigKind(filePath);
      if (!bundler) {
        return undefined;
      }
      try {
        return {
          kind: "bundler-config" as const,
          bundler,
          filePath,
          absolutePath,
          sourceText: await readFile(absolutePath, "utf8"),
        };
      } catch (error) {
        input.diagnostics.push({
          code: "loading.bundler-config-read-failed",
          severity: "warning",
          phase: "loading",
          filePath,
          message: `failed to read bundler config ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        return undefined;
      }
    }),
  );

  return loadedConfigFiles.filter((file): file is ProjectBundlerConfigFile => Boolean(file));
}

async function discoverBundlerConfigFileRecords(input: {
  rootDir: string;
  diagnostics: ScanDiagnostic[];
}): Promise<ProjectFileRecord[]> {
  const files: ProjectFileRecord[] = [];
  try {
    await walkBundlerConfigFiles(input.rootDir, input.rootDir, files);
  } catch (error) {
    input.diagnostics.push({
      code: "discovery.bundler-config-read-failed",
      severity: "warning",
      phase: "discovery",
      filePath: ".",
      message: `failed to inspect bundler config files: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function walkBundlerConfigFiles(
  rootDir: string,
  currentDir: string,
  files: ProjectFileRecord[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DISCOVERY_DIRECTORIES.has(entry.name)) {
        await walkBundlerConfigFiles(rootDir, path.join(currentDir, entry.name), files);
      }
      continue;
    }

    if (!entry.isFile() || !isBundlerConfigFileName(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    files.push({
      filePath: normalizeProjectPath(path.relative(rootDir, absolutePath)),
      absolutePath,
    });
  }
}

function isBundlerConfigFileName(fileName: string): boolean {
  return Boolean(getRootBundlerConfigKind(fileName));
}

function getRootBundlerConfigKind(
  fileName: string,
): ProjectBundlerConfigFile["bundler"] | undefined {
  const baseName = path.basename(fileName);
  if (/^vite\.config\.[cm]?[jt]s$/.test(baseName)) {
    return "vite";
  }
  if (/^webpack\.config\.[cm]?[jt]s$/.test(baseName)) {
    return "webpack";
  }
  if (/^next\.config\.[cm]?[jt]s$/.test(baseName)) {
    return "next";
  }
  if (/^remix\.config\.[cm]?[jt]s$/.test(baseName)) {
    return "remix";
  }
  if (/^astro\.config\.[cm]?[jt]s$/.test(baseName)) {
    return "astro";
  }
  return undefined;
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort((left, right) => left[0].localeCompare(right[0])),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function hasRootDiscoveryError(diagnostics: ScanDiagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" && diagnostic.code.startsWith("discovery.root-"),
  );
}

function collectConfigFiles(config: ResolvedScannerConfig): ProjectConfigFile[] {
  return [
    {
      kind: "config",
      source: config.source,
      ...("path" in config.source ? { filePath: config.source.path } : {}),
    },
  ];
}
