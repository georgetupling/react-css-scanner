import type { RuleSeverity } from "../rules/types.js";

export type RuleConfigSeverity = RuleSeverity | "off";

export type CssModuleLocalsConvention = "asIs" | "camelCase" | "camelCaseOnly";

export type CssModulesConfig = {
  localsConvention: CssModuleLocalsConvention;
};

export type ExternalCssGlobalProviderConfig = {
  provider: string;
  match: string[];
  classPrefixes: string[];
  classNames: string[];
  stylesheetRole: "external-global" | "third-party-runtime";
};

export type ExternalCssConfig = {
  fetchRemote: boolean;
  globals: ExternalCssGlobalProviderConfig[];
  remoteTimeoutMs: number;
};

export type OwnershipConfig = {
  sharedCss: string[];
  sharingPolicy: "strict" | "balanced" | "permissive";
};

export type DiscoveryConfig = {
  sourceRoots: string[];
  exclude: string[];
  publicRoots: string[];
  aliases: Record<string, string[]>;
  stylesheetExtensions: string[];
};

export type IgnoreConfig = {
  classNames: string[];
  filePaths: string[];
};

export type ReportingConfig = {
  verbose: boolean;
  json: boolean;
  trace: boolean;
  debugRuntimeCss: boolean;
  outputDirectory?: string;
  overwriteOutput: boolean;
};

export type ScannerConfig = {
  failOnSeverity: RuleSeverity;
  rules: Record<string, RuleConfigSeverity>;
  cssModules: CssModulesConfig;
  externalCss: ExternalCssConfig;
  ownership: OwnershipConfig;
  discovery: DiscoveryConfig;
  ignore: IgnoreConfig;
  reporting: ReportingConfig;
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
