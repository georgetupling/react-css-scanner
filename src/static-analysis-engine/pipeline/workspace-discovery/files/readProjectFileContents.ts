import { readFile } from "node:fs/promises";
import type { DiscoveryConfig } from "../../../../config/index.js";
import type { ProjectFileRecord, ScanDiagnostic } from "../../../../project/types.js";
import { isCssModulePath } from "../../../libraries/stylesheets/cssModulePaths.js";
import type {
  JsonStaticValue,
  ProjectHtmlFile,
  ProjectJsonFile,
  ProjectSourceFile,
  ProjectStylesheetFile,
} from "../types.js";
import { compileStylesheetSource } from "../stylesheets/compileStylesheetSource.js";

const MAX_JSON_DEPTH = 12;
const MAX_JSON_ARRAY_ELEMENTS = 200;
const MAX_JSON_OBJECT_PROPERTIES = 200;

export async function readSourceFiles(
  sourceFiles: ProjectFileRecord[],
  diagnostics: ScanDiagnostic[],
): Promise<ProjectSourceFile[]> {
  const loadedFiles = await Promise.all(
    sourceFiles.map(async (sourceFile) => {
      const content = await readProjectFile(sourceFile, diagnostics);
      return content
        ? {
            kind: "source" as const,
            filePath: sourceFile.filePath,
            absolutePath: sourceFile.absolutePath,
            sourceText: content,
          }
        : undefined;
    }),
  );

  return loadedFiles.filter((file): file is ProjectSourceFile => Boolean(file));
}

export async function readCssFiles(
  cssFiles: ProjectFileRecord[],
  diagnostics: ScanDiagnostic[],
  origin: ProjectStylesheetFile["origin"],
  options: {
    rootDir: string;
    knownStylesheetFilePaths: ReadonlySet<string>;
    discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
  },
): Promise<ProjectStylesheetFile[]> {
  const loadedFiles: Array<ProjectStylesheetFile | undefined> = await Promise.all(
    cssFiles.map(async (cssFile) => {
      const content = await readProjectFile(cssFile, diagnostics);
      if (!content) {
        return undefined;
      }

      const compiled = await compileStylesheetSource({
        rootDir: options.rootDir,
        filePath: cssFile.filePath,
        absolutePath: cssFile.absolutePath,
        sourceText: content,
        knownStylesheetFilePaths: options.knownStylesheetFilePaths,
        discovery: options.discovery,
        diagnostics,
      });

      return {
        kind: "stylesheet" as const,
        filePath: cssFile.filePath,
        absolutePath: cssFile.absolutePath,
        cssText: compiled.cssText,
        cssKind: getCssKind(cssFile.filePath),
        origin,
        sourceSyntax: compiled.sourceSyntax,
        ...(compiled.compiledFrom ? { compiledFrom: compiled.compiledFrom } : {}),
      };
    }),
  );

  return loadedFiles.filter((file): file is ProjectStylesheetFile => Boolean(file));
}

export async function readHtmlFiles(
  htmlFiles: ProjectFileRecord[],
  diagnostics: ScanDiagnostic[],
): Promise<ProjectHtmlFile[]> {
  const loadedFiles = await Promise.all(
    htmlFiles.map(async (htmlFile) => {
      const content = await readProjectFile(htmlFile, diagnostics);
      return content
        ? {
            kind: "html" as const,
            filePath: htmlFile.filePath,
            absolutePath: htmlFile.absolutePath,
            htmlText: content,
          }
        : undefined;
    }),
  );

  return loadedFiles.filter((file): file is ProjectHtmlFile => Boolean(file));
}

export async function readJsonFiles(
  jsonFiles: ProjectFileRecord[],
  diagnostics: ScanDiagnostic[],
): Promise<ProjectJsonFile[]> {
  const loadedFiles = await Promise.all(
    jsonFiles.map(async (jsonFile) => {
      const content = await readProjectFile(jsonFile, diagnostics);
      if (!content) {
        return undefined;
      }

      const parsedValue = parseJsonStaticValue({
        filePath: jsonFile.filePath,
        sourceText: content,
        diagnostics,
      });

      return {
        kind: "json" as const,
        filePath: jsonFile.filePath,
        absolutePath: jsonFile.absolutePath,
        sourceText: content,
        ...(parsedValue ? { parsedValue } : {}),
      };
    }),
  );

  return loadedFiles.filter((file): file is ProjectJsonFile => Boolean(file));
}

function getCssKind(filePath: string): ProjectStylesheetFile["cssKind"] {
  return isCssModulePath(filePath) ? "css-module" : "global-css";
}

async function readProjectFile(
  file: ProjectFileRecord,
  diagnostics: ScanDiagnostic[],
): Promise<string | undefined> {
  try {
    return await readFile(file.absolutePath, "utf8");
  } catch (error) {
    diagnostics.push({
      code: "loading.file-read-failed",
      severity: "error",
      phase: "loading",
      filePath: file.filePath,
      message: `failed to read ${file.filePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

function parseJsonStaticValue(input: {
  filePath: string;
  sourceText: string;
  diagnostics: ScanDiagnostic[];
}): JsonStaticValue | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.sourceText);
  } catch (error) {
    input.diagnostics.push({
      code: "loading.json-parse-failed",
      severity: "warning",
      phase: "loading",
      filePath: input.filePath,
      message: `failed to parse JSON file ${input.filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return undefined;
  }

  return toJsonStaticValue(parsed, 0);
}

function toJsonStaticValue(value: unknown, depth: number): JsonStaticValue {
  if (depth > MAX_JSON_DEPTH) {
    return { kind: "unknown", reason: "json-depth-budget-exceeded" };
  }

  if (typeof value === "string") {
    return { kind: "string", value };
  }

  if (typeof value === "number") {
    return { kind: "number", value };
  }

  if (typeof value === "boolean") {
    return { kind: "boolean", value };
  }

  if (value === null) {
    return { kind: "null" };
  }

  if (Array.isArray(value)) {
    const elements = value
      .slice(0, MAX_JSON_ARRAY_ELEMENTS)
      .map((element) => toJsonStaticValue(element, depth + 1));
    return {
      kind: "array",
      elements,
      ...(value.length > MAX_JSON_ARRAY_ELEMENTS ? { truncated: true } : {}),
    };
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, MAX_JSON_OBJECT_PROPERTIES);
    return {
      kind: "object",
      properties: Object.fromEntries(
        entries.map(([key, propertyValue]) => [key, toJsonStaticValue(propertyValue, depth + 1)]),
      ),
      ...(Object.keys(value).length > MAX_JSON_OBJECT_PROPERTIES ? { truncated: true } : {}),
    };
  }

  return { kind: "unknown", reason: "unsupported-json-value" };
}
