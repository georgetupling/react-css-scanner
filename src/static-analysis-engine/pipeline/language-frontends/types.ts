import type { ResolvedScannerConfig } from "../../../config/index.js";
import type { CssStyleRuleFact } from "../../types/css.js";
import type { ExternalCssAnalysisInput } from "../external-css/index.js";
import type { ProjectAnalysisStylesheetInput } from "../project-analysis/index.js";
import type { SelectorSourceInput, ExtractedSelectorQuery } from "../selector-analysis/index.js";
import type {
  ProjectBoundary,
  ProjectResourceEdge,
  ProjectSnapshot,
} from "../workspace-discovery/index.js";
import type { ParsedProjectFile } from "../../entry/stages/types.js";
import type { SourceAnchor } from "../../types/core.js";
import type { SourceModuleSyntaxFacts } from "./source/moduleSyntax.js";

export type LanguageFrontendsInput = {
  snapshot: ProjectSnapshot;
};

export type LanguageFrontendsResult = {
  snapshot: ProjectSnapshot;
  source: SourceFrontendFacts;
  css: CssFrontendFacts;
};

export type SourceFrontendFacts = {
  files: SourceFrontendFile[];
  filesByPath: Map<string, SourceFrontendFile>;
};

export type SourceFrontendFile = {
  filePath: string;
  absolutePath: string;
  languageKind: SourceLanguageKind;
  sourceText: string;
  moduleSyntax: SourceModuleSyntaxFacts;
  runtimeDomClassSites: RuntimeDomClassSite[];
  legacy: {
    parsedFile: ParsedProjectFile;
  };
};

export type SourceLanguageKind = "js" | "jsx" | "ts" | "tsx";

export type RuntimeDomClassSiteKind = "prosemirror-editor-view-attributes";

export type RuntimeDomClassSite = {
  kind: RuntimeDomClassSiteKind;
  filePath: string;
  location: SourceAnchor;
  rawExpressionText: string;
  classText: string;
  runtimeLibraryHint?: RuntimeDomLibraryHint;
  trace: {
    adapterName: string;
    summary: string;
  };
};

export type RuntimeDomLibraryHint = {
  packageName: string;
  importedName: string;
  localName: string;
};

export type CssFrontendFacts = {
  files: CssFrontendFile[];
  filesByPath: Map<string, CssFrontendFile>;
};

export type CssFrontendFile = {
  filePath: string;
  absolutePath?: string;
  cssText: string;
  cssKind: "global-css" | "css-module";
  origin: "project" | "html-linked" | "package" | "remote";
  rules: CssStyleRuleFact[];
  selectorEntries: ExtractedSelectorQuery[];
};

export type LanguageFrontendsCompatibility = {
  sourceFiles: Array<{ filePath: string; sourceText: string }>;
  parsedFiles: ParsedProjectFile[];
  selectorCssSources: SelectorSourceInput[];
  projectAnalysisStylesheets: ProjectAnalysisStylesheetInput[];
  boundaries: ProjectBoundary[];
  resourceEdges: ProjectResourceEdge[];
  cssModules: ResolvedScannerConfig["cssModules"];
  externalCss: ExternalCssAnalysisInput;
  projectRoot: string;
};
