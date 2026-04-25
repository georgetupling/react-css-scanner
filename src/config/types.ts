import type { RuleSeverity } from "../rules/types.js";

export type RuleConfigSeverity = RuleSeverity | "off";

export type CssModuleLocalsConvention = "asIs" | "camelCase" | "camelCaseOnly";

export type CssModulesConfig = {
  localsConvention: CssModuleLocalsConvention;
};

export type ScannerConfig = {
  failOnSeverity: RuleSeverity;
  rules: Record<string, RuleConfigSeverity>;
  cssModules: CssModulesConfig;
};

export type ResolvedScannerConfig = ScannerConfig & {
  source:
    | {
        kind: "explicit";
        path: string;
      }
    | {
        kind: "project";
        path: string;
      }
    | {
        kind: "env";
        path: string;
      }
    | {
        kind: "path";
        path: string;
      }
    | {
        kind: "default";
      };
};
