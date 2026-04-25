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
};

export type ExternalCssAnalysisInput = {
  enabled?: boolean;
  modes?: ExternalCssSourceMode[];
  globalProviders?: ExternalCssGlobalProviderConfig[];
  htmlStylesheetLinks?: HtmlStylesheetLinkInput[];
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
  projectWideStylesheetFilePaths: string[];
};
