export type ExternalCssSourceMode =
  | "declared-globals"
  | "imported-packages"
  | "html-links"
  | "fetch-remote";

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

export type PackageCssImportInput = {
  importerKind: "source" | "stylesheet";
  importerFilePath: string;
  specifier: string;
  resolvedFilePath: string;
};

export type ExternalCssAnalysisInput = {
  enabled?: boolean;
  modes?: ExternalCssSourceMode[];
  globalProviders?: ExternalCssGlobalProviderConfig[];
  htmlStylesheetLinks?: HtmlStylesheetLinkInput[];
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
  modes: ExternalCssSourceMode[];
  activeProviders: ActiveExternalCssProvider[];
  packageCssImports: PackageCssImportInput[];
  projectWideStylesheetFilePaths: string[];
  externalStylesheetFilePaths: string[];
};
