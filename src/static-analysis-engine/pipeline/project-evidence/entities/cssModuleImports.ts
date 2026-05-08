import type {
  CssModuleImportAnalysis,
  ProjectEvidenceBuildInput,
  ProjectEvidenceBuilderIndexes,
} from "../analysisTypes.js";
import { compareById, createCssModuleImportId, normalizeProjectPath } from "../internal/shared.js";

export function buildCssModuleImports(
  input: ProjectEvidenceBuildInput,
  indexes: ProjectEvidenceBuilderIndexes,
): CssModuleImportAnalysis[] {
  const imports: CssModuleImportAnalysis[] = [];

  for (const sourceFile of input.factGraph.frontends.source.files) {
    for (const importSyntax of sourceFile.moduleSyntax.imports) {
      if (importSyntax.importKind !== "css") {
        continue;
      }
      const stylesheetFilePath = findResolvedStylesheetImportPath({
        sourceFilePath: sourceFile.filePath,
        specifier: importSyntax.specifier,
        input,
      });
      if (!stylesheetFilePath || !isCssModuleStylesheet(stylesheetFilePath, input)) {
        continue;
      }

      const sourceFileId = indexes.sourceFileIdByPath.get(sourceFile.filePath.replace(/\\/g, "/"));
      const stylesheetId = indexes.stylesheetIdByPath.get(stylesheetFilePath.replace(/\\/g, "/"));
      if (!sourceFileId || !stylesheetId) {
        continue;
      }

      for (const binding of importSyntax.importNames) {
        imports.push({
          id: createCssModuleImportId({
            sourceFilePath: sourceFile.filePath,
            stylesheetFilePath,
            localName: binding.localName,
          }),
          sourceFileId,
          stylesheetId,
          sourceFilePath: sourceFile.filePath.replace(/\\/g, "/"),
          stylesheetFilePath: stylesheetFilePath.replace(/\\/g, "/"),
          specifier: importSyntax.specifier,
          localName: binding.localName,
          importKind: binding.kind,
        });
      }
    }
  }

  return imports.sort(compareById);
}

function findResolvedStylesheetImportPath(input: {
  sourceFilePath: string;
  specifier: string;
  input: ProjectEvidenceBuildInput;
}): string | undefined {
  const normalizedSourceFilePath = normalizeProjectPath(input.sourceFilePath);
  return input.input.factGraph.graph.edges.imports.find(
    (edge) =>
      edge.importerKind === "source" &&
      normalizeProjectPath(edge.importerFilePath) === normalizedSourceFilePath &&
      edge.importKind === "css" &&
      edge.specifier === input.specifier,
  )?.resolvedFilePath;
}

function isCssModuleStylesheet(
  stylesheetFilePath: string,
  input: ProjectEvidenceBuildInput,
): boolean {
  return (
    input.factGraph.snapshot.files.stylesheets.find(
      (stylesheet) =>
        normalizeProjectPath(stylesheet.filePath) === normalizeProjectPath(stylesheetFilePath),
    )?.cssKind === "css-module"
  );
}
