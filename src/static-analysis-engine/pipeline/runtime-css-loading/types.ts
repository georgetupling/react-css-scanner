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
  availability: "definite" | "possible" | "unknown" | "unavailable";
  entryId: string;
  chunkId: string;
  entrySourceFilePath: string;
  htmlFilePath?: string;
  bundlerProfileId: string;
  bundler: RuntimeCssBundlerProfile["bundler"];
  cssLoading: RuntimeCssBundlerProfile["cssLoading"];
  confidence: RuntimeCssBundlerProfile["confidence"];
  reason:
    | "stylesheet is loaded by the same HTML app entry bundle"
    | "stylesheet is loaded by the same lazy runtime CSS chunk"
    | "stylesheet may be loaded by a dynamic CSS import"
    | "stylesheet may be loaded by an unresolved dynamic import"
    | "stylesheet may be loaded because bundler CSS chunk behavior is unknown";
};

export type RuntimeCssLoadingResult = {
  bundlerProfiles: RuntimeCssBundlerProfile[];
  entries: RuntimeCssEntry[];
  chunks: RuntimeCssChunk[];
  availability: RuntimeCssAvailability[];
};
