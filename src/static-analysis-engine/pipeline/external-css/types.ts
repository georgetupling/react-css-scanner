export type ExternalCssGlobalProviderConfig = {
  provider: string;
  match: string[];
  classPrefixes: string[];
  classNames: string[];
};

export type HtmlStylesheetLinkInput = {
  filePath: string;
  href: string;
  isRemote: boolean;
  resolvedFilePath?: string;
};

export type HtmlScriptSourceInput = {
  filePath: string;
  src: string;
  resolvedFilePath?: string;
  appRootPath?: string;
};

export type PackageCssImportInput = {
  importerKind: "source" | "stylesheet";
  importerFilePath: string;
  specifier: string;
  resolvedFilePath: string;
};

export type ExternalCssAnalysisInput = {
  fetchRemote?: boolean;
  globalProviders?: ExternalCssGlobalProviderConfig[];
  htmlStylesheetLinks?: HtmlStylesheetLinkInput[];
  htmlScriptSources?: HtmlScriptSourceInput[];
  packageCssImports?: PackageCssImportInput[];
};

export type ActiveExternalCssProvider = {
  provider: string;
  match: string[];
  classPrefixes: string[];
  classNames: string[];
  matchedStylesheets: HtmlStylesheetLinkInput[];
};

export type ExternalCssSummary = {
  enabled: boolean;
  fetchRemote: boolean;
  activeProviders: ActiveExternalCssProvider[];
  packageCssImports: PackageCssImportInput[];
  projectWideEntrySources: Array<{
    entrySourceFilePath: string;
    appRootPath: string;
  }>;
  projectWideStylesheetFilePaths: string[];
  externalStylesheetFilePaths: string[];
};
