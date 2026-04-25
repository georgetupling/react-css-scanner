import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ScanDiagnostic } from "../project/types.js";
import type { RuleSeverity } from "../rules/types.js";
import { DEFAULT_RULE_SEVERITIES } from "../rules/catalogue.js";
import type {
  CssModuleLocalsConvention,
  ResolvedScannerConfig,
  RuleConfigSeverity,
  ScannerConfig,
} from "./types.js";

const CONFIG_FILE_NAME = "scan-react-css.json";
const CONFIG_DIR_ENV_VAR = "SCAN_REACT_CSS_CONFIG_DIR";

const RULE_SEVERITIES = new Set<RuleSeverity>(["debug", "info", "warn", "error"]);
const RULE_CONFIG_VALUES = new Set<RuleConfigSeverity>(["off", "debug", "info", "warn", "error"]);
const CSS_MODULE_LOCALS_CONVENTIONS = new Set<CssModuleLocalsConvention>([
  "asIs",
  "camelCase",
  "camelCaseOnly",
]);

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  failOnSeverity: "error",
  rules: {
    ...DEFAULT_RULE_SEVERITIES,
  },
  cssModules: {
    localsConvention: "camelCase",
  },
};

export async function loadScannerConfig(input: {
  rootDir: string;
  configPath?: string;
  diagnostics: ScanDiagnostic[];
}): Promise<ResolvedScannerConfig> {
  const explicitConfigPath = input.configPath
    ? path.resolve(input.rootDir, input.configPath)
    : undefined;

  if (explicitConfigPath) {
    return loadConfigFile({
      absolutePath: explicitConfigPath,
      source: {
        kind: "explicit",
        path: normalizeProjectPath(path.relative(input.rootDir, explicitConfigPath)),
      },
      diagnostics: input.diagnostics,
    });
  }

  const projectConfigPath = path.join(input.rootDir, CONFIG_FILE_NAME);
  if (await fileExists(projectConfigPath)) {
    return loadConfigFile({
      absolutePath: projectConfigPath,
      source: {
        kind: "project",
        path: CONFIG_FILE_NAME,
      },
      diagnostics: input.diagnostics,
    });
  }

  const envConfigDir = process.env[CONFIG_DIR_ENV_VAR];
  if (envConfigDir) {
    const envConfigPath = path.join(envConfigDir, CONFIG_FILE_NAME);
    if (await fileExists(envConfigPath)) {
      return loadConfigFile({
        absolutePath: envConfigPath,
        source: {
          kind: "env",
          path: normalizeProjectPath(envConfigPath),
        },
        diagnostics: input.diagnostics,
      });
    }
  }

  const pathConfigPath = await findConfigOnOsPath();
  if (pathConfigPath) {
    return loadConfigFile({
      absolutePath: pathConfigPath,
      source: {
        kind: "path",
        path: normalizeProjectPath(pathConfigPath),
      },
      diagnostics: input.diagnostics,
    });
  }

  return {
    ...DEFAULT_SCANNER_CONFIG,
    source: {
      kind: "default",
    },
  };
}

async function loadConfigFile(input: {
  absolutePath: string;
  source: Exclude<ResolvedScannerConfig["source"], { kind: "default" }>;
  diagnostics: ScanDiagnostic[];
}): Promise<ResolvedScannerConfig> {
  try {
    const content = await readFile(input.absolutePath, "utf8");
    return {
      ...parseConfig(content, input.source.path, input.diagnostics),
      source: input.source,
    };
  } catch (error) {
    input.diagnostics.push({
      code: "config.load-failed",
      severity: "error",
      phase: "config",
      filePath: input.source.path,
      message: `failed to load config ${input.source.path}: ${error instanceof Error ? error.message : String(error)}`,
    });

    return {
      ...DEFAULT_SCANNER_CONFIG,
      source: input.source,
    };
  }
}

function parseConfig(
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
    return DEFAULT_SCANNER_CONFIG;
  }

  if (!isRecord(parsed)) {
    diagnostics.push({
      code: "config.invalid-shape",
      severity: "error",
      phase: "config",
      filePath,
      message: "config must be a JSON object",
    });
    return DEFAULT_SCANNER_CONFIG;
  }

  return {
    failOnSeverity: parseFailOnSeverity(parsed.failOnSeverity, filePath, diagnostics),
    rules: {
      ...DEFAULT_RULE_SEVERITIES,
      ...parseRules(parsed.rules, filePath, diagnostics),
    },
    cssModules: parseCssModules(parsed.cssModules, filePath, diagnostics),
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
    return DEFAULT_SCANNER_CONFIG.cssModules;
  }

  if (!isRecord(value)) {
    diagnostics.push({
      code: "config.invalid-css-modules",
      severity: "error",
      phase: "config",
      filePath,
      message: "cssModules must be an object",
    });
    return DEFAULT_SCANNER_CONFIG.cssModules;
  }

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
  return DEFAULT_SCANNER_CONFIG.cssModules;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findConfigOnOsPath(): Promise<string | undefined> {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return undefined;
  }

  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, CONFIG_FILE_NAME);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
