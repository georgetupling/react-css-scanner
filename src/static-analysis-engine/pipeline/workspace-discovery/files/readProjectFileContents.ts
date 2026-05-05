import { readFile } from "node:fs/promises";
import type { ProjectFileRecord, ScanDiagnostic } from "../../../../project/types.js";
import type { ProjectHtmlFile, ProjectSourceFile, ProjectStylesheetFile } from "../types.js";

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
): Promise<ProjectStylesheetFile[]> {
  const loadedFiles: Array<ProjectStylesheetFile | undefined> = await Promise.all(
    cssFiles.map(async (cssFile) => {
      const content = await readProjectFile(cssFile, diagnostics);
      return content
        ? {
            kind: "stylesheet" as const,
            filePath: cssFile.filePath,
            absolutePath: cssFile.absolutePath,
            cssText: content,
            cssKind: getCssKind(cssFile.filePath),
            origin,
          }
        : undefined;
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

function getCssKind(filePath: string): ProjectStylesheetFile["cssKind"] {
  return /\.module\.(?:[cm]?css|less|sass|scss)$/i.test(filePath) ? "css-module" : "global-css";
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
