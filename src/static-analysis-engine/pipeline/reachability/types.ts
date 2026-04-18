export type ReachabilityAvailability = "definite" | "unknown" | "unavailable";

export type StylesheetReachabilityRecord = {
  cssFilePath?: string;
  availability: ReachabilityAvailability;
  directlyImportingSourceFilePaths: string[];
  reasons: string[];
};

export type ReachabilitySummary = {
  stylesheets: StylesheetReachabilityRecord[];
};
