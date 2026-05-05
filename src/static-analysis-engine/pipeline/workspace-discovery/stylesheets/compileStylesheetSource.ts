import path from "node:path";
import { readFile } from "node:fs/promises";
import less from "less";

import type { DiscoveryConfig } from "../../../../config/index.js";
import type { ScanDiagnostic } from "../../../../project/types.js";
import type { ProjectStylesheetFile, StylesheetSourceMap } from "../types.js";
import { resolveWorkspaceSpecifier } from "../resolution/index.js";

export type CompiledStylesheetSource = {
  cssText: string;
  sourceSyntax: NonNullable<ProjectStylesheetFile["sourceSyntax"]>;
  compiledFrom?: ProjectStylesheetFile["compiledFrom"];
};

export async function compileStylesheetSource(input: {
  rootDir: string;
  filePath: string;
  absolutePath: string;
  sourceText: string;
  knownStylesheetFilePaths: ReadonlySet<string>;
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
  diagnostics: ScanDiagnostic[];
}): Promise<CompiledStylesheetSource> {
  const sourceSyntax = getStylesheetSourceSyntax(input.filePath);
  if (sourceSyntax !== "less") {
    return {
      cssText: input.sourceText,
      sourceSyntax,
    };
  }

  try {
    const output = await less.render(input.sourceText, {
      filename: input.absolutePath,
      paths: [path.dirname(input.absolutePath)],
      javascriptEnabled: false,
      plugins: [
        {
          install(_less, pluginManager) {
            pluginManager.addFileManager(
              new ProjectLessFileManager({
                rootDir: input.rootDir,
                knownStylesheetFilePaths: input.knownStylesheetFilePaths,
                discovery: input.discovery,
              }),
            );
          },
        },
      ],
      sourceMap: {
        outputSourceFiles: true,
      },
    });
    const sourceMap = parseLessSourceMap({
      filePath: input.filePath,
      mapText: output.map,
      diagnostics: input.diagnostics,
    });

    return {
      cssText: output.css,
      sourceSyntax,
      compiledFrom: {
        syntax: "less",
        originalText: input.sourceText,
        ...(sourceMap ? { sourceMap } : {}),
      },
    };
  } catch (error) {
    input.diagnostics.push({
      code: "loading.less-compile-failed",
      severity: "warning",
      phase: "loading",
      filePath: input.filePath,
      message: `failed to compile Less stylesheet ${input.filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return {
      cssText: input.sourceText,
      sourceSyntax,
    };
  }
}

class ProjectLessFileManager extends less.FileManager {
  readonly #rootDir: string;
  readonly #knownStylesheetFilePaths: ReadonlySet<string>;
  readonly #discovery: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions"> | undefined;

  constructor(input: {
    rootDir: string;
    knownStylesheetFilePaths: ReadonlySet<string>;
    discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
  }) {
    super();
    this.#rootDir = input.rootDir;
    this.#knownStylesheetFilePaths = input.knownStylesheetFilePaths;
    this.#discovery = input.discovery;
  }

  override supports(filename: string, currentDirectory: string): boolean {
    return Boolean(this.#resolveProjectStylesheetPath(filename, currentDirectory));
  }

  override async loadFile(
    filename: string,
    currentDirectory: string,
  ): Promise<Less.FileLoadResult> {
    const filePath = this.#resolveProjectStylesheetPath(filename, currentDirectory);
    if (!filePath) {
      throw new Error(`could not resolve ${filename}`);
    }

    const absolutePath = path.join(this.#rootDir, filePath);
    return {
      filename: absolutePath,
      contents: await readFile(absolutePath, "utf8"),
    };
  }

  #resolveProjectStylesheetPath(filename: string, currentDirectory: string): string | undefined {
    const resolution = resolveWorkspaceSpecifier({
      importerFilePath: getImporterFilePath({
        rootDir: this.#rootDir,
        currentDirectory,
      }),
      specifier: filename,
      targetKind: "stylesheet",
      knownStylesheetFilePaths: this.#knownStylesheetFilePaths,
      discovery: this.#discovery,
    });
    return resolution.status === "resolved" && resolution.kind === "project"
      ? resolution.filePath
      : undefined;
  }
}

function parseLessSourceMap(input: {
  filePath: string;
  mapText: string | undefined;
  diagnostics: ScanDiagnostic[];
}): StylesheetSourceMap | undefined {
  if (!input.mapText) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.mapText);
  } catch (error) {
    input.diagnostics.push({
      code: "loading.less-sourcemap-invalid",
      severity: "warning",
      phase: "loading",
      filePath: input.filePath,
      message: `failed to read Less source map for ${input.filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return undefined;
  }

  if (!isStylesheetSourceMap(parsed)) {
    input.diagnostics.push({
      code: "loading.less-sourcemap-invalid",
      severity: "warning",
      phase: "loading",
      filePath: input.filePath,
      message: `failed to read Less source map for ${input.filePath}: source map had an unsupported shape`,
    });
    return undefined;
  }

  return parsed;
}

function isStylesheetSourceMap(value: unknown): value is StylesheetSourceMap {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 3 &&
    Array.isArray(value.sources) &&
    value.sources.every((source) => typeof source === "string") &&
    typeof value.mappings === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getImporterFilePath(input: { rootDir: string; currentDirectory: string }): string {
  const relativeDirectory = normalizeProjectPath(
    path.relative(input.rootDir, input.currentDirectory),
  );
  return relativeDirectory
    ? `${relativeDirectory}/__less_importer__.less`
    : "__less_importer__.less";
}

function getStylesheetSourceSyntax(
  filePath: string,
): NonNullable<ProjectStylesheetFile["sourceSyntax"]> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".less") {
    return "less";
  }
  if (extension === ".scss") {
    return "scss";
  }
  if (extension === ".sass") {
    return "sass";
  }
  return "css";
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
