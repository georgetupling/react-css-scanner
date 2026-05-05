export type RuntimeCssBundlerProfile = {
  id: string;
  bundler: "vite" | "unknown";
  cssLoading: "split-by-runtime-chunk" | "single-initial-stylesheet" | "generic-esm-chunks";
  confidence: "high" | "medium";
  evidence: string[];
  reason: string;
};

export type RuntimeCssEntry = {
  id: string;
  kind: "html-entry" | "conventional-entry";
  entrySourceFilePath: string;
  htmlFilePath?: string;
  confidence: "high" | "medium";
  reason: string;
};

export type RuntimeCssChunk = {
  id: string;
  entryId: string;
  loading: "initial" | "lazy";
  rootSourceFilePath: string;
  sourceFilePaths: string[];
  stylesheetFilePaths: string[];
  reason: string;
};

export type RuntimeCssAvailability = {
  stylesheetFilePath: string;
  sourceFilePath: string;
  availability: "definite";
  entryId: string;
  chunkId: string;
  entrySourceFilePath: string;
  htmlFilePath?: string;
  reason:
    | "stylesheet is loaded by the same HTML app entry bundle"
    | "stylesheet is loaded by the same lazy runtime CSS chunk";
};

export type RuntimeCssLoadingResult = {
  bundlerProfiles: RuntimeCssBundlerProfile[];
  entries: RuntimeCssEntry[];
  chunks: RuntimeCssChunk[];
  availability: RuntimeCssAvailability[];
};
