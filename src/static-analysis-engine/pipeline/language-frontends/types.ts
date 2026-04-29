import type { CssStyleRuleFact } from "../../types/css.js";
import type { ExtractedSelectorQuery } from "../selector-analysis/index.js";
import type { ProjectSnapshot } from "../workspace-discovery/index.js";
import type { ParsedProjectFile } from "../../entry/stages/types.js";
import type { SourceAnchor } from "../../types/core.js";
import type { SourceModuleSyntaxFacts } from "./source/module-syntax/index.js";
import type { SourceReactSyntaxFacts } from "./source/react-syntax/index.js";

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
  reactSyntax: SourceReactSyntaxFacts;
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
