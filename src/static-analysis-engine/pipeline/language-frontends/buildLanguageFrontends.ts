import { extractCssStyleRules } from "../../libraries/css-parsing/index.js";
import type { ParsedCssSelectorEntry } from "../../libraries/selector-parsing/index.js";
import type { ParsedProjectFile } from "../../entry/stages/types.js";
import type { ExtractedSelectorQuery } from "../../libraries/selector-parsing/queryTypes.js";
import type { ProjectSnapshot } from "../workspace-discovery/index.js";
import { collectSourceModuleSyntax } from "./source/module-syntax/index.js";
import { parseSourceFile } from "./source/parseSourceFile.js";
import { dedupeExpressionSyntaxFacts } from "./source/expression-syntax/index.js";
import { collectSourceReactSyntax } from "./source/react-syntax/index.js";
import { extractRuntimeDomClassSites } from "./source/runtime-dom-syntax/extractRuntimeDomSites.js";
import type {
  CssFrontendFacts,
  CssFrontendFile,
  LanguageFrontendsResult,
  SourceFrontendFacts,
  SourceFrontendFile,
  SourceLanguageKind,
  RuntimeDomClassSite,
} from "./types.js";
import type { SourceExpressionSyntaxFact } from "./source/expression-syntax/index.js";

type SourceFrontendInputFile = {
  filePath: string;
  absolutePath: string;
  sourceText: string;
};

export function buildLanguageFrontends(input: {
  snapshot: ProjectSnapshot;
}): LanguageFrontendsResult {
  const source = buildSourceFrontendFacts(input.snapshot);
  const css = buildCssFrontendFacts(input.snapshot);

  return {
    snapshot: input.snapshot,
    source,
    css,
  };
}

function buildSourceFrontendFacts(snapshot: ProjectSnapshot): SourceFrontendFacts {
  return buildSourceFrontendFactsFromSourceFiles(snapshot.files.sourceFiles);
}

export function buildSourceFrontendFactsFromSourceFiles(
  sourceFiles: SourceFrontendInputFile[],
): SourceFrontendFacts {
  const files: SourceFrontendFile[] = [...sourceFiles]
    .sort((left, right) => left.filePath.localeCompare(right.filePath))
    .map((sourceFile) => {
      const parsedFile = {
        filePath: sourceFile.filePath,
        parsedSourceFile: parseSourceFile(sourceFile),
      };
      const filePath = normalizeFilePath(sourceFile.filePath);
      const moduleSyntax = collectSourceModuleSyntax({
        filePath,
        sourceFile: parsedFile.parsedSourceFile,
      });
      const reactSyntax = collectSourceReactSyntax({
        filePath,
        sourceFile: parsedFile.parsedSourceFile,
        moduleSyntax,
      });
      const runtimeDomClassSites = extractRuntimeDomClassSites({
        filePath,
        sourceFile: parsedFile.parsedSourceFile,
        moduleSyntax,
      });

      return {
        filePath: sourceFile.filePath,
        absolutePath: sourceFile.absolutePath,
        languageKind: getSourceLanguageKind(sourceFile.filePath),
        sourceText: sourceFile.sourceText,
        moduleSyntax,
        reactSyntax,
        expressionSyntax: buildSourceExpressionSyntaxFacts({
          reactSyntax,
          runtimeDomClassSites,
        }),
        runtimeDomClassSites,
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
    .map((parsedFile) => {
      const filePath = normalizeFilePath(parsedFile.filePath);
      const moduleSyntax = collectSourceModuleSyntax({
        filePath,
        sourceFile: parsedFile.parsedSourceFile,
      });
      const reactSyntax = collectSourceReactSyntax({
        filePath,
        sourceFile: parsedFile.parsedSourceFile,
        moduleSyntax,
      });
      const runtimeDomClassSites = extractRuntimeDomClassSites({
        filePath,
        sourceFile: parsedFile.parsedSourceFile,
        moduleSyntax,
      });

      return {
        filePath: parsedFile.filePath,
        absolutePath: parsedFile.filePath,
        languageKind: getSourceLanguageKind(parsedFile.filePath),
        sourceText: parsedFile.parsedSourceFile.getFullText(),
        moduleSyntax,
        reactSyntax,
        expressionSyntax: buildSourceExpressionSyntaxFacts({
          reactSyntax,
          runtimeDomClassSites,
        }),
        runtimeDomClassSites,
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

function buildSourceExpressionSyntaxFacts(input: {
  reactSyntax: SourceFrontendFile["reactSyntax"];
  runtimeDomClassSites: RuntimeDomClassSite[];
}): SourceExpressionSyntaxFact[] {
  return dedupeExpressionSyntaxFacts([
    ...input.reactSyntax.expressionSyntax,
    ...input.runtimeDomClassSites.map(runtimeDomClassSiteToExpressionSyntaxFact),
  ]);
}

function runtimeDomClassSiteToExpressionSyntaxFact(
  site: RuntimeDomClassSite,
): SourceExpressionSyntaxFact {
  return {
    expressionId: site.expressionId,
    filePath: site.filePath,
    location: site.location,
    rawText: site.rawExpressionText,
    expressionKind: "string-literal",
    literalKind: site.rawExpressionText.startsWith("`") ? "no-substitution-template" : "string",
    value: site.classText,
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
