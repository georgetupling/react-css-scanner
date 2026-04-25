import type { RuleSeverity } from "../rules/types.js";

export type RuleConfigSeverity = RuleSeverity | "off";

export type CssModuleLocalsConvention = "asIs" | "camelCase" | "camelCaseOnly";

export type CssModulesConfig = {
  localsConvention: CssModuleLocalsConvention;
};

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

export type ExternalCssConfig = {
  enabled: boolean;
  modes: ExternalCssSourceMode[];
  globals: ExternalCssGlobalProviderConfig[];
  remoteTimeoutMs: number;
};

export type ScannerConfig = {
  failOnSeverity: RuleSeverity;
  rules: Record<string, RuleConfigSeverity>;
  cssModules: CssModulesConfig;
  externalCss: ExternalCssConfig;
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
