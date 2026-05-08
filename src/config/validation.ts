import type { ScanDiagnostic } from "../project/types.js";
import { DEFAULT_RULE_SEVERITIES } from "../rules/catalogue.js";
import type { RuleSeverity } from "../rules/types.js";
import type {
  CssModuleLocalsConvention,
  ExternalCssGlobalProviderConfig,
  OwnershipConfig,
  RuleConfigSeverity,
  ScannerConfig,
} from "./types.js";
import {
  cloneDiscoveryConfig,
  cloneExternalCssConfig,
  cloneExternalCssGlobals,
  cloneIgnoreConfig,
  cloneOwnershipConfig,
  cloneReportingConfig,
  cloneScannerConfig,
} from "./cloneConfig.js";
import { DEFAULT_SCANNER_CONFIG } from "./defaults.js";

const RULE_SEVERITIES = new Set<RuleSeverity>(["debug", "info", "warn", "error"]);
const RULE_CONFIG_VALUES = new Set<RuleConfigSeverity>(["off", "debug", "info", "warn", "error"]);
const CSS_MODULE_LOCALS_CONVENTIONS = new Set<CssModuleLocalsConvention>([
  "asIs",
  "camelCase",
  "camelCaseOnly",
]);
const TOP_LEVEL_CONFIG_KEYS = new Set([
  "failOnSeverity",
  "rules",
  "cssModules",
  "externalCss",
  "ownership",
  "discovery",
  "ignore",
  "reporting",
]);
const CSS_MODULES_CONFIG_KEYS = new Set(["localsConvention"]);
const EXTERNAL_CSS_CONFIG_KEYS = new Set(["fetchRemote", "globals", "remoteTimeoutMs"]);
const OWNERSHIP_CONFIG_KEYS = new Set(["sharedCss", "sharingPolicy"]);
const OWNERSHIP_SHARING_POLICIES = new Set<OwnershipConfig["sharingPolicy"]>([
  "strict",
  "balanced",
  "permissive",
]);
const DISCOVERY_CONFIG_KEYS = new Set([
  "sourceRoots",
  "exclude",
  "publicRoots",
  "aliases",
  "stylesheetExtensions",
]);
const IGNORE_CONFIG_KEYS = new Set(["classNames", "filePaths"]);
const REPORTING_CONFIG_KEYS = new Set([
  "verbose",
  "json",
  "trace",
  "debugRuntimeCss",
  "outputDirectory",
  "overwriteOutput",
]);
const EXTERNAL_CSS_GLOBAL_CONFIG_KEYS = new Set([
  "provider",
  "match",
  "classPrefixes",
  "classNames",
  "stylesheetRole",
]);
const EXTERNAL_CSS_STYLESHEET_ROLES = new Set(["external-global", "third-party-runtime"]);
const RULE_IDS = new Set(Object.keys(DEFAULT_RULE_SEVERITIES));

export function parseConfig(
  content: string,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ScannerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    diagnostics.push({
      code: "config.invalid-json",
      severity: "error",
      phase: "config",
      filePath,
      message: `failed to parse config ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return cloneScannerConfig(DEFAULT_SCANNER_CONFIG);
  }

  if (!isRecord(parsed)) {
    diagnostics.push({
      code: "config.invalid-shape",
      severity: "error",
      phase: "config",
      filePath,
      message: "config must be a JSON object",
    });
    return cloneScannerConfig(DEFAULT_SCANNER_CONFIG);
  }

  reportUnknownKeys({
    value: parsed,
    allowedKeys: TOP_LEVEL_CONFIG_KEYS,
    filePath,
    diagnostics,
    objectName: "config",
    code: "config.unknown-key",
  });

  return {
    failOnSeverity: parseFailOnSeverity(parsed.failOnSeverity, filePath, diagnostics),
    rules: {
      ...DEFAULT_RULE_SEVERITIES,
      ...parseRules(parsed.rules, filePath, diagnostics),
    },
    cssModules: parseCssModules(parsed.cssModules, filePath, diagnostics),
    externalCss: parseExternalCss(parsed.externalCss, filePath, diagnostics),
    ownership: parseOwnership(parsed.ownership, filePath, diagnostics),
    discovery: parseDiscovery(parsed.discovery, filePath, diagnostics),
    ignore: parseIgnore(parsed.ignore, filePath, diagnostics),
    reporting: parseReporting(parsed.reporting, filePath, diagnostics),
  };
}

function parseFailOnSeverity(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): RuleSeverity {
  if (value === undefined) {
    return DEFAULT_SCANNER_CONFIG.failOnSeverity;
  }

  if (typeof value === "string" && RULE_SEVERITIES.has(value as RuleSeverity)) {
    return value as RuleSeverity;
  }

  diagnostics.push({
    code: "config.invalid-fail-threshold",
    severity: "error",
    phase: "config",
    filePath,
    message: 'failOnSeverity must be one of "debug", "info", "warn", or "error"',
  });
  return DEFAULT_SCANNER_CONFIG.failOnSeverity;
}

function parseRules(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): Record<string, RuleConfigSeverity> {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-rules",
      severity: "error",
      phase: "config",
      filePath,
      message: "rules must be an object mapping rule IDs to severity strings",
    });
    return {};
  }

  const rules: Record<string, RuleConfigSeverity> = {};
  for (const [ruleId, ruleValue] of Object.entries(value)) {
    if (!RULE_IDS.has(ruleId)) {
      diagnostics.push({
        code: "config.unknown-rule",
        severity: "error",
        phase: "config",
        filePath,
        message: `unknown rule "${ruleId}" in rules config`,
      });
      continue;
    }

    if (typeof ruleValue === "string" && RULE_CONFIG_VALUES.has(ruleValue as RuleConfigSeverity)) {
      rules[ruleId] = ruleValue as RuleConfigSeverity;
      continue;
    }

    diagnostics.push({
      code: "config.invalid-rule-severity",
      severity: "error",
      phase: "config",
      filePath,
      message: `rule "${ruleId}" must be "off", "debug", "info", "warn", or "error"`,
    });
  }

  return rules;
}

function parseCssModules(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ScannerConfig["cssModules"] {
  if (value === undefined) {
    return { ...DEFAULT_SCANNER_CONFIG.cssModules };
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-css-modules",
      severity: "error",
      phase: "config",
      filePath,
      message: "cssModules must be an object",
    });
    return { ...DEFAULT_SCANNER_CONFIG.cssModules };
  }

  reportUnknownKeys({
    value,
    allowedKeys: CSS_MODULES_CONFIG_KEYS,
    filePath,
    diagnostics,
    objectName: "cssModules",
    code: "config.unknown-css-modules-key",
  });

  const localsConvention = value.localsConvention;
  if (
    localsConvention === undefined ||
    (typeof localsConvention === "string" &&
      CSS_MODULE_LOCALS_CONVENTIONS.has(localsConvention as CssModuleLocalsConvention))
  ) {
    return {
      localsConvention:
        localsConvention === undefined
          ? DEFAULT_SCANNER_CONFIG.cssModules.localsConvention
          : (localsConvention as CssModuleLocalsConvention),
    };
  }

  diagnostics.push({
    code: "config.invalid-css-modules-locals-convention",
    severity: "error",
    phase: "config",
    filePath,
    message: 'cssModules.localsConvention must be "asIs", "camelCase", or "camelCaseOnly"',
  });
  return { ...DEFAULT_SCANNER_CONFIG.cssModules };
}

function parseExternalCss(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ScannerConfig["externalCss"] {
  if (value === undefined) {
    return cloneExternalCssConfig(DEFAULT_SCANNER_CONFIG.externalCss);
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-external-css",
      severity: "error",
      phase: "config",
      filePath,
      message: "externalCss must be an object",
    });
    return cloneExternalCssConfig(DEFAULT_SCANNER_CONFIG.externalCss);
  }

  reportUnknownKeys({
    value,
    allowedKeys: EXTERNAL_CSS_CONFIG_KEYS,
    filePath,
    diagnostics,
    objectName: "externalCss",
    code: "config.unknown-external-css-key",
  });

  return {
    fetchRemote: parseOptionalBoolean({
      value: value.fetchRemote,
      fallback: DEFAULT_SCANNER_CONFIG.externalCss.fetchRemote,
      filePath,
      diagnostics,
      code: "config.invalid-external-css-fetch-remote",
      message: "externalCss.fetchRemote must be a boolean",
    }),
    globals: parseExternalCssGlobals(value.globals, filePath, diagnostics),
    remoteTimeoutMs: parseOptionalPositiveNumber({
      value: value.remoteTimeoutMs,
      fallback: DEFAULT_SCANNER_CONFIG.externalCss.remoteTimeoutMs,
      filePath,
      diagnostics,
      code: "config.invalid-external-css-timeout",
      message: "externalCss.remoteTimeoutMs must be a positive number",
    }),
  };
}

function parseOwnership(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ScannerConfig["ownership"] {
  if (value === undefined) {
    return cloneOwnershipConfig(DEFAULT_SCANNER_CONFIG.ownership);
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-ownership",
      severity: "error",
      phase: "config",
      filePath,
      message: "ownership must be an object",
    });
    return cloneOwnershipConfig(DEFAULT_SCANNER_CONFIG.ownership);
  }

  reportUnknownKeys({
    value,
    allowedKeys: OWNERSHIP_CONFIG_KEYS,
    filePath,
    diagnostics,
    objectName: "ownership",
    code: "config.unknown-ownership-key",
  });

  return {
    sharedCss: parseStringArray({
      value: value.sharedCss,
      fallback: DEFAULT_SCANNER_CONFIG.ownership.sharedCss,
      filePath,
      diagnostics,
      code: "config.invalid-ownership-shared-css",
      message: "ownership.sharedCss must be an array of non-empty strings",
      requireNonEmpty: true,
    }),
    sharingPolicy: parseOwnershipSharingPolicy({
      value: value.sharingPolicy,
      fallback: DEFAULT_SCANNER_CONFIG.ownership.sharingPolicy,
      filePath,
      diagnostics,
    }),
  };
}

function parseOwnershipSharingPolicy(input: {
  value: unknown;
  fallback: OwnershipConfig["sharingPolicy"];
  filePath: string;
  diagnostics: ScanDiagnostic[];
}): OwnershipConfig["sharingPolicy"] {
  if (input.value === undefined) {
    return input.fallback;
  }

  if (
    typeof input.value === "string" &&
    OWNERSHIP_SHARING_POLICIES.has(input.value as OwnershipConfig["sharingPolicy"])
  ) {
    return input.value as OwnershipConfig["sharingPolicy"];
  }

  input.diagnostics.push({
    code: "config.invalid-ownership-sharing-policy",
    severity: "error",
    phase: "config",
    filePath: input.filePath,
    message: 'ownership.sharingPolicy must be "strict", "balanced", or "permissive"',
  });
  return input.fallback;
}

function parseIgnore(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ScannerConfig["ignore"] {
  if (value === undefined) {
    return cloneIgnoreConfig(DEFAULT_SCANNER_CONFIG.ignore);
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-ignore",
      severity: "error",
      phase: "config",
      filePath,
      message: "ignore must be an object",
    });
    return cloneIgnoreConfig(DEFAULT_SCANNER_CONFIG.ignore);
  }

  reportUnknownKeys({
    value,
    allowedKeys: IGNORE_CONFIG_KEYS,
    filePath,
    diagnostics,
    objectName: "ignore",
    code: "config.unknown-ignore-key",
  });

  return {
    classNames: parseStringArray({
      value: value.classNames,
      fallback: DEFAULT_SCANNER_CONFIG.ignore.classNames,
      filePath,
      diagnostics,
      code: "config.invalid-ignore-class-names",
      message: "ignore.classNames must be an array of non-empty strings",
      requireNonEmpty: true,
    }),
    filePaths: parseStringArray({
      value: value.filePaths,
      fallback: DEFAULT_SCANNER_CONFIG.ignore.filePaths,
      filePath,
      diagnostics,
      code: "config.invalid-ignore-file-paths",
      message: "ignore.filePaths must be an array of non-empty strings",
      requireNonEmpty: true,
    }),
  };
}

function parseDiscovery(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ScannerConfig["discovery"] {
  if (value === undefined) {
    return cloneDiscoveryConfig(DEFAULT_SCANNER_CONFIG.discovery);
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-discovery",
      severity: "error",
      phase: "config",
      filePath,
      message: "discovery must be an object",
    });
    return cloneDiscoveryConfig(DEFAULT_SCANNER_CONFIG.discovery);
  }

  reportUnknownKeys({
    value,
    allowedKeys: DISCOVERY_CONFIG_KEYS,
    filePath,
    diagnostics,
    objectName: "discovery",
    code: "config.unknown-discovery-key",
  });

  return {
    sourceRoots: parseStringArray({
      value: value.sourceRoots,
      fallback: DEFAULT_SCANNER_CONFIG.discovery.sourceRoots,
      filePath,
      diagnostics,
      code: "config.invalid-discovery-source-roots",
      message: "discovery.sourceRoots must be an array of non-empty strings",
      requireNonEmpty: true,
    }),
    exclude: parseStringArray({
      value: value.exclude,
      fallback: DEFAULT_SCANNER_CONFIG.discovery.exclude,
      filePath,
      diagnostics,
      code: "config.invalid-discovery-exclude",
      message: "discovery.exclude must be an array of non-empty strings",
      requireNonEmpty: true,
    }),
    publicRoots: parseStringArray({
      value: value.publicRoots,
      fallback: DEFAULT_SCANNER_CONFIG.discovery.publicRoots,
      filePath,
      diagnostics,
      code: "config.invalid-discovery-public-roots",
      message: "discovery.publicRoots must be an array of non-empty strings",
      requireNonEmpty: true,
    }),
    aliases: parseAliases(value.aliases, filePath, diagnostics),
    stylesheetExtensions: normalizeStylesheetExtensions(
      parseStringArray({
        value: value.stylesheetExtensions,
        fallback: DEFAULT_SCANNER_CONFIG.discovery.stylesheetExtensions,
        filePath,
        diagnostics,
        code: "config.invalid-discovery-stylesheet-extensions",
        message: "discovery.stylesheetExtensions must be an array of non-empty strings",
        requireNonEmpty: true,
      }),
    ),
  };
}

function parseReporting(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ScannerConfig["reporting"] {
  if (value === undefined) {
    return cloneReportingConfig(DEFAULT_SCANNER_CONFIG.reporting);
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-reporting",
      severity: "error",
      phase: "config",
      filePath,
      message: "reporting must be an object",
    });
    return cloneReportingConfig(DEFAULT_SCANNER_CONFIG.reporting);
  }

  reportUnknownKeys({
    value,
    allowedKeys: REPORTING_CONFIG_KEYS,
    filePath,
    diagnostics,
    objectName: "reporting",
    code: "config.unknown-reporting-key",
  });

  return {
    verbose: parseOptionalBoolean({
      value: value.verbose,
      fallback: DEFAULT_SCANNER_CONFIG.reporting.verbose,
      filePath,
      diagnostics,
      code: "config.invalid-reporting-verbose",
      message: "reporting.verbose must be a boolean",
    }),
    json: parseOptionalBoolean({
      value: value.json,
      fallback: DEFAULT_SCANNER_CONFIG.reporting.json,
      filePath,
      diagnostics,
      code: "config.invalid-reporting-json",
      message: "reporting.json must be a boolean",
    }),
    trace: parseOptionalBoolean({
      value: value.trace,
      fallback: DEFAULT_SCANNER_CONFIG.reporting.trace,
      filePath,
      diagnostics,
      code: "config.invalid-reporting-trace",
      message: "reporting.trace must be a boolean",
    }),
    debugRuntimeCss: parseOptionalBoolean({
      value: value.debugRuntimeCss,
      fallback: DEFAULT_SCANNER_CONFIG.reporting.debugRuntimeCss,
      filePath,
      diagnostics,
      code: "config.invalid-reporting-debug-runtime-css",
      message: "reporting.debugRuntimeCss must be a boolean",
    }),
    outputDirectory: parseOptionalNonEmptyString({
      value: value.outputDirectory,
      filePath,
      diagnostics,
      code: "config.invalid-reporting-output-directory",
      message: "reporting.outputDirectory must be a non-empty string",
    }),
    overwriteOutput: parseOptionalBoolean({
      value: value.overwriteOutput,
      fallback: DEFAULT_SCANNER_CONFIG.reporting.overwriteOutput,
      filePath,
      diagnostics,
      code: "config.invalid-reporting-overwrite-output",
      message: "reporting.overwriteOutput must be a boolean",
    }),
  };
}

function parseExternalCssGlobals(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ExternalCssGlobalProviderConfig[] {
  if (value === undefined) {
    return cloneExternalCssGlobals(DEFAULT_SCANNER_CONFIG.externalCss.globals);
  }

  if (!Array.isArray(value)) {
    diagnostics.push({
      code: "config.invalid-external-css-globals",
      severity: "error",
      phase: "config",
      filePath,
      message: "externalCss.globals must be an array",
    });
    return cloneExternalCssGlobals(DEFAULT_SCANNER_CONFIG.externalCss.globals);
  }

  return [
    ...cloneExternalCssGlobals(DEFAULT_SCANNER_CONFIG.externalCss.globals),
    ...value.flatMap((entry, index) =>
      parseExternalCssGlobalProvider(entry, index, filePath, diagnostics),
    ),
  ];
}

function parseExternalCssGlobalProvider(
  value: unknown,
  index: number,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): ExternalCssGlobalProviderConfig[] {
  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-external-css-global",
      severity: "error",
      phase: "config",
      filePath,
      message: `externalCss.globals[${index}] must be an object`,
    });
    return [];
  }

  reportUnknownKeys({
    value,
    allowedKeys: EXTERNAL_CSS_GLOBAL_CONFIG_KEYS,
    filePath,
    diagnostics,
    objectName: `externalCss.globals[${index}]`,
    code: "config.unknown-external-css-global-key",
  });

  const provider = parseRequiredString({
    value: value.provider,
    filePath,
    diagnostics,
    code: "config.invalid-external-css-provider",
    message: `externalCss.globals[${index}].provider must be a non-empty string`,
  });
  const match = parseStringArray({
    value: value.match,
    fallback: [],
    filePath,
    diagnostics,
    code: "config.invalid-external-css-provider-match",
    message: `externalCss.globals[${index}].match must be an array of strings`,
  });
  const classPrefixes = parseStringArray({
    value: value.classPrefixes,
    fallback: [],
    filePath,
    diagnostics,
    code: "config.invalid-external-css-provider-prefixes",
    message: `externalCss.globals[${index}].classPrefixes must be an array of strings`,
  });
  const classNames = parseStringArray({
    value: value.classNames,
    fallback: [],
    filePath,
    diagnostics,
    code: "config.invalid-external-css-provider-class-names",
    message: `externalCss.globals[${index}].classNames must be an array of strings`,
  });
  const stylesheetRole = parseStylesheetRole({
    value: value.stylesheetRole,
    fallback: "external-global",
    filePath,
    diagnostics,
    index,
  });

  if (!provider) {
    return [];
  }

  return [
    {
      provider,
      match,
      classPrefixes,
      classNames,
      stylesheetRole,
    },
  ];
}

function parseStylesheetRole(input: {
  value: unknown;
  fallback: ExternalCssGlobalProviderConfig["stylesheetRole"];
  filePath: string;
  diagnostics: ScanDiagnostic[];
  index: number;
}): ExternalCssGlobalProviderConfig["stylesheetRole"] {
  if (input.value === undefined) {
    return input.fallback;
  }

  if (typeof input.value === "string" && EXTERNAL_CSS_STYLESHEET_ROLES.has(input.value)) {
    return input.value as ExternalCssGlobalProviderConfig["stylesheetRole"];
  }

  input.diagnostics.push({
    code: "config.invalid-external-css-provider-stylesheet-role",
    severity: "error",
    phase: "config",
    filePath: input.filePath,
    message: `externalCss.globals[${input.index}].stylesheetRole must be "external-global" or "third-party-runtime"`,
  });
  return input.fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reportUnknownKeys(input: {
  value: Record<string, unknown>;
  allowedKeys: Set<string>;
  filePath: string;
  diagnostics: ScanDiagnostic[];
  objectName: string;
  code: string;
}): void {
  for (const key of Object.keys(input.value)) {
    if (input.allowedKeys.has(key)) {
      continue;
    }

    input.diagnostics.push({
      code: input.code,
      severity: "error",
      phase: "config",
      filePath: input.filePath,
      message: `unknown ${input.objectName} key "${key}"`,
    });
  }
}

function parseRequiredString(input: {
  value: unknown;
  filePath: string;
  diagnostics: ScanDiagnostic[];
  code: string;
  message: string;
}): string | undefined {
  if (typeof input.value === "string" && input.value.trim()) {
    return input.value;
  }

  input.diagnostics.push({
    code: input.code,
    severity: "error",
    phase: "config",
    filePath: input.filePath,
    message: input.message,
  });
  return undefined;
}

function parseStringArray(input: {
  value: unknown;
  fallback: string[];
  filePath: string;
  diagnostics: ScanDiagnostic[];
  code: string;
  message: string;
  requireNonEmpty?: boolean;
}): string[] {
  if (input.value === undefined) {
    return input.fallback;
  }

  if (
    Array.isArray(input.value) &&
    input.value.every(
      (entry) => typeof entry === "string" && (!input.requireNonEmpty || entry.trim().length > 0),
    )
  ) {
    return input.value;
  }

  input.diagnostics.push({
    code: input.code,
    severity: "error",
    phase: "config",
    filePath: input.filePath,
    message: input.message,
  });
  return input.fallback;
}

function parseOptionalBoolean(input: {
  value: unknown;
  fallback: boolean;
  filePath: string;
  diagnostics: ScanDiagnostic[];
  code: string;
  message: string;
}): boolean {
  if (input.value === undefined) {
    return input.fallback;
  }

  if (typeof input.value === "boolean") {
    return input.value;
  }

  input.diagnostics.push({
    code: input.code,
    severity: "error",
    phase: "config",
    filePath: input.filePath,
    message: input.message,
  });
  return input.fallback;
}

function parseOptionalPositiveNumber(input: {
  value: unknown;
  fallback: number;
  filePath: string;
  diagnostics: ScanDiagnostic[];
  code: string;
  message: string;
}): number {
  if (input.value === undefined) {
    return input.fallback;
  }

  if (typeof input.value === "number" && Number.isFinite(input.value) && input.value > 0) {
    return input.value;
  }

  input.diagnostics.push({
    code: input.code,
    severity: "error",
    phase: "config",
    filePath: input.filePath,
    message: input.message,
  });
  return input.fallback;
}

function parseOptionalNonEmptyString(input: {
  value: unknown;
  filePath: string;
  diagnostics: ScanDiagnostic[];
  code: string;
  message: string;
}): string | undefined {
  if (input.value === undefined) {
    return undefined;
  }

  if (typeof input.value === "string" && input.value.trim().length > 0) {
    return input.value;
  }

  input.diagnostics.push({
    code: input.code,
    severity: "error",
    phase: "config",
    filePath: input.filePath,
    message: input.message,
  });
  return undefined;
}

function parseAliases(
  value: unknown,
  filePath: string,
  diagnostics: ScanDiagnostic[],
): Record<string, string[]> {
  if (value === undefined) {
    return { ...DEFAULT_SCANNER_CONFIG.discovery.aliases };
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-discovery-aliases",
      severity: "error",
      phase: "config",
      filePath,
      message: "discovery.aliases must be an object mapping alias patterns to string arrays",
    });
    return { ...DEFAULT_SCANNER_CONFIG.discovery.aliases };
  }

  const aliases: Record<string, string[]> = {};
  for (const [key, aliasValue] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!key.trim() || !Array.isArray(aliasValue)) {
      diagnostics.push({
        code: "config.invalid-discovery-aliases",
        severity: "error",
        phase: "config",
        filePath,
        message: "discovery.aliases must map non-empty alias patterns to string arrays",
      });
      continue;
    }

    const targets = aliasValue.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    if (targets.length !== aliasValue.length) {
      diagnostics.push({
        code: "config.invalid-discovery-aliases",
        severity: "error",
        phase: "config",
        filePath,
        message: `discovery.aliases["${key}"] must contain only non-empty strings`,
      });
      continue;
    }

    aliases[key] = targets;
  }

  return aliases;
}

function normalizeStylesheetExtensions(extensions: string[]): string[] {
  return [
    ...new Set(
      extensions.map((extension) => {
        const normalized = extension.trim().toLowerCase();
        return normalized.startsWith(".") ? normalized : `.${normalized}`;
      }),
    ),
  ].sort((left, right) => left.localeCompare(right));
}
