import type { AnalysisTrace } from "../../types/analysis.js";

export type ReachabilityAvailability = "definite" | "possible" | "unknown" | "unavailable";

export type ReachabilityDerivation =
  | {
      kind: "source-file-direct-import";
    }
  | {
      kind: "source-file-project-wide-external-css";
      stylesheetHref: string;
    }
  | {
      kind: "whole-component-direct-import";
    }
  | {
      kind: "whole-component-all-known-renderers-definite";
    }
  | {
      kind: "whole-component-at-least-one-renderer";
    }
  | {
      kind: "whole-component-only-possible-renderers";
    }
  | {
      kind: "placement-derived-region";
      toComponentName: string;
      toFilePath?: string;
      renderPath: "definite" | "possible" | "unknown";
    }
  | {
      kind: "whole-component-unknown-barrier";
      reason: string;
    }
  | {
      kind: "render-region-unknown-barrier";
      reason: string;
    };

export type StylesheetReachabilityContext =
  | {
      kind: "source-file";
      filePath: string;
    }
  | {
      kind: "component";
      filePath: string;
      componentName: string;
    }
  | {
      kind: "render-subtree-root";
      filePath: string;
      componentName?: string;
      rootAnchor: {
        startLine: number;
        startColumn: number;
        endLine?: number;
        endColumn?: number;
      };
    }
  | {
      kind: "render-region";
      filePath: string;
      componentName?: string;
      regionKind: import("../render-model/render-ir/types.js").RenderRegionKind;
      path: import("../render-model/render-ir/types.js").RenderRegionPathSegment[];
      sourceAnchor: {
        startLine: number;
        startColumn: number;
        endLine?: number;
        endColumn?: number;
      };
    };

export type StylesheetReachabilityContextRecord = {
  context: StylesheetReachabilityContext;
  availability: ReachabilityAvailability;
  reasons: string[];
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
};

export type StylesheetReachabilityRecord = {
  cssFilePath?: string;
  availability: ReachabilityAvailability;
  contexts: StylesheetReachabilityContextRecord[];
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ReachabilitySummary = {
  stylesheets: StylesheetReachabilityRecord[];
};
