import { extractCssStyleRules } from "../../libraries/css-parsing/index.js";
import type { ParsedCssSelectorEntry } from "../../libraries/selector-parsing/index.js";
import type { ParsedProjectFile } from "../../entry/stages/types.js";
import { parseSourceFile } from "../parse/index.js";
import type { ExtractedSelectorQuery } from "../selector-analysis/index.js";
import type { ProjectSnapshot } from "../workspace-discovery/index.js";
import { collectSourceModuleSyntax } from "./source/moduleSyntax.js";
import type {
  CssFrontendFacts,
  CssFrontendFile,
  LanguageFrontendsResult,
  SourceFrontendFacts,
  SourceFrontendFile,
  SourceLanguageKind,
} from "./types.js";

export function buildLanguageFrontends(input: {
  snapshot: ProjectSnapshot;
}): LanguageFrontendsResult {
  const source = buildSourceFrontendFacts(input.snapshot);
  const css = buildCssFrontendFacts(input.snapshot);

  return {
    snapshot: input.snapshot,
    source,
    css,
    compatibility: {
      sourceFiles: source.files.map((file) => ({
        filePath: file.filePath,
        sourceText: file.sourceText,
      })),
      parsedFiles: source.files.map((file) => file.legacy.parsedFile),
      selectorCssSources: css.files.map((file) => ({
        filePath: file.filePath,
        cssText: file.cssText,
      })),
      projectAnalysisStylesheets: css.files.map((file) => ({
        filePath: file.filePath,
        cssKind: file.cssKind,
        origin: file.origin,
      })),
      boundaries: [...input.snapshot.boundaries],
      resourceEdges: [...input.snapshot.edges],
      cssModules: input.snapshot.config.cssModules,
      externalCss: {
        fetchRemote: input.snapshot.externalCss.fetchRemote,
        globalProviders: input.snapshot.externalCss.globalProviders,
      },
      projectRoot: input.snapshot.rootDir,
    },
  };
}

function buildSourceFrontendFacts(snapshot: ProjectSnapshot): SourceFrontendFacts {
  const files: SourceFrontendFile[] = [...snapshot.files.sourceFiles]
    .sort((left, right) => left.filePath.localeCompare(right.filePath))
    .map((sourceFile) => {
      const parsedFile = {
        filePath: sourceFile.filePath,
        parsedSourceFile: parseSourceFile(sourceFile),
      };

      return {
        filePath: sourceFile.filePath,
        absolutePath: sourceFile.absolutePath,
        languageKind: getSourceLanguageKind(sourceFile.filePath),
        sourceText: sourceFile.sourceText,
        moduleSyntax: collectSourceModuleSyntax({
          filePath: normalizeFilePath(sourceFile.filePath),
          sourceFile: parsedFile.parsedSourceFile,
        }),
        legacy: {
          parsedFile,
        },
      };
    });

  return {
    files,
    filesByPath: new Map(files.map((file) => [file.filePath, file])),
  };
}

export function buildSourceFrontendFactsFromParsedFiles(
  parsedFiles: ParsedProjectFile[],
): SourceFrontendFacts {
  const files: SourceFrontendFile[] = [...parsedFiles]
    .sort((left, right) => left.filePath.localeCompare(right.filePath))
    .map((parsedFile) => ({
      filePath: parsedFile.filePath,
      absolutePath: parsedFile.filePath,
      languageKind: getSourceLanguageKind(parsedFile.filePath),
      sourceText: parsedFile.parsedSourceFile.getFullText(),
      moduleSyntax: collectSourceModuleSyntax({
        filePath: normalizeFilePath(parsedFile.filePath),
        sourceFile: parsedFile.parsedSourceFile,
      }),
      legacy: {
        parsedFile,
      },
    }));

  return {
    files,
    filesByPath: new Map(files.map((file) => [file.filePath, file])),
  };
}

function buildCssFrontendFacts(snapshot: ProjectSnapshot): CssFrontendFacts {
  const files: CssFrontendFile[] = [...snapshot.files.stylesheets]
    .sort((left, right) => left.filePath.localeCompare(right.filePath))
    .map((stylesheet) => {
      const rules = extractCssStyleRules({
        cssText: stylesheet.cssText,
        filePath: stylesheet.filePath,
      });

      return {
        filePath: stylesheet.filePath,
        absolutePath: stylesheet.absolutePath,
        cssText: stylesheet.cssText,
        cssKind: stylesheet.cssKind,
        origin: stylesheet.origin,
        rules,
        selectorEntries: rules.flatMap((rule) =>
          rule.selectorEntries.map(projectSelectorEntryToQuery),
        ),
      };
    });

  return {
    files,
    filesByPath: new Map(files.map((file) => [file.filePath, file])),
  };
}

function projectSelectorEntryToQuery(entry: ParsedCssSelectorEntry): ExtractedSelectorQuery {
  return {
    selectorText: entry.selectorText,
    source: {
      kind: "css-source",
      selectorAnchor: entry.selectorAnchor,
      selectorListText: entry.selectorListText,
      branchIndex: entry.branchIndex,
      branchCount: entry.branchCount,
      ruleKey: entry.ruleKey,
      ...(entry.atRuleContext
        ? {
            atRuleContext: entry.atRuleContext,
          }
        : {}),
    },
  };
}

function getSourceLanguageKind(filePath: string): SourceLanguageKind {
  if (/\.tsx$/i.test(filePath)) {
    return "tsx";
  }

  if (/\.jsx$/i.test(filePath)) {
    return "jsx";
  }

  if (/\.ts$/i.test(filePath)) {
    return "ts";
  }

  return "js";
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
