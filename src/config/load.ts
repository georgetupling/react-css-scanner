import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  type ExternalCssMode,
  type OwnershipNamingConvention,
  type RawReactCssScannerConfig,
  type ResolvedReactCssScannerConfig,
  type RuleConfigObject,
  type RuleConfigValue,
  type RuleSeverity,
} from "./types.js";

const CONFIG_FILE_NAME = "react-css-scanner.json";

const TOP_LEVEL_KEYS = new Set([
  "$schema",
  "rootDir",
  "source",
  "css",
  "ownership",
  "externalCss",
  "classComposition",
  "policy",
  "rules",
]);

const SOURCE_KEYS = new Set(["include", "exclude"]);
const CSS_KEYS = new Set(["global", "utilities", "modules"]);
const CSS_MODULE_KEYS = new Set(["enabled", "patterns"]);
const OWNERSHIP_KEYS = new Set(["pagePatterns", "componentCssPatterns", "namingConvention"]);
const EXTERNAL_CSS_KEYS = new Set(["enabled", "mode"]);
const CLASS_COMPOSITION_KEYS = new Set(["helpers"]);
const POLICY_KEYS = new Set(["failOnSeverity"]);
const RULE_OBJECT_KEYS = new Set([
  "severity",
  "threshold",
  "minDeclarationOverlap",
  "minOccurrences",
  "minDeclarations",
]);

const RULE_SEVERITIES: RuleSeverity[] = ["off", "info", "warning", "error"];
const FAIL_ON_SEVERITIES: Array<Exclude<RuleSeverity, "off">> = ["info", "warning", "error"];
const OWNERSHIP_NAMING_CONVENTIONS: OwnershipNamingConvention[] = ["off", "sibling"];
const EXTERNAL_CSS_MODES: ExternalCssMode[] = ["imported-only"];

export type ConfigSourceKind =
  | "inline"
  | "explicit-path"
  | "project-root"
  | "env-dir"
  | "path"
  | "built-in-defaults";

export type ResolvedConfigSource = {
  kind: ConfigSourceKind;
  filePath?: string;
};

export type LoadReactCssScannerConfigOptions = {
  cwd?: string;
  config?: RawReactCssScannerConfig;
  configPath?: string;
  env?: Record<string, string | undefined>;
};

export type LoadedReactCssScannerConfig = {
  config: ResolvedReactCssScannerConfig;
  source: ResolvedConfigSource;
  warnings: string[];
};

export class ReactCssScannerConfigError extends Error {
  readonly filePath?: string;
  readonly path?: string;

  constructor(message: string, options?: { filePath?: string; path?: string }) {
    super(message);
    this.name = "ReactCssScannerConfigError";
    this.filePath = options?.filePath;
    this.path = options?.path;
  }
}

export async function loadReactCssScannerConfig(
  options: LoadReactCssScannerConfigOptions = {},
): Promise<LoadedReactCssScannerConfig> {
  if (options.config !== undefined) {
    return {
      config: normalizeReactCssScannerConfig(options.config),
      source: { kind: "inline" },
      warnings: [],
    };
  }

  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const discoveredConfig = await discoverConfigFile({
    configPath: options.configPath,
    cwd,
    env,
  });

  if (!discoveredConfig) {
    return {
      config: cloneResolvedConfig(DEFAULT_CONFIG),
      source: { kind: "built-in-defaults" },
      warnings: [
        "No react-css-scanner.json config file was found; built-in defaults were used. Create a config file to make scanner behavior explicit.",
      ],
    };
  }

  const configFilePath = discoveredConfig.filePath;

  if (!configFilePath) {
    throw new ReactCssScannerConfigError(
      `Resolved config source "${discoveredConfig.kind}" is missing a file path`,
    );
  }

  const rawConfig = await readRawConfigFile(configFilePath);

  return {
    config: normalizeReactCssScannerConfig(rawConfig, {
      filePath: configFilePath,
    }),
    source: discoveredConfig,
    warnings: [],
  };
}

export function normalizeReactCssScannerConfig(
  rawConfig: RawReactCssScannerConfig,
  options: { filePath?: string } = {},
): ResolvedReactCssScannerConfig {
  assertPlainObject(rawConfig, "config", options.filePath);
  assertKnownKeys(rawConfig, TOP_LEVEL_KEYS, "config", options.filePath);

  const source = rawConfig.source;
  if (source !== undefined) {
    assertPlainObject(source, "config.source", options.filePath);
    assertKnownKeys(source, SOURCE_KEYS, "config.source", options.filePath);
  }

  const css = rawConfig.css;
  if (css !== undefined) {
    assertPlainObject(css, "config.css", options.filePath);
    assertKnownKeys(css, CSS_KEYS, "config.css", options.filePath);
  }

  const cssModules = css?.modules;
  if (cssModules !== undefined) {
    assertPlainObject(cssModules, "config.css.modules", options.filePath);
    assertKnownKeys(cssModules, CSS_MODULE_KEYS, "config.css.modules", options.filePath);
  }

  const ownership = rawConfig.ownership;
  if (ownership !== undefined) {
    assertPlainObject(ownership, "config.ownership", options.filePath);
    assertKnownKeys(ownership, OWNERSHIP_KEYS, "config.ownership", options.filePath);
  }

  const externalCss = rawConfig.externalCss;
  if (externalCss !== undefined) {
    assertPlainObject(externalCss, "config.externalCss", options.filePath);
    assertKnownKeys(externalCss, EXTERNAL_CSS_KEYS, "config.externalCss", options.filePath);
  }

  const classComposition = rawConfig.classComposition;
  if (classComposition !== undefined) {
    assertPlainObject(classComposition, "config.classComposition", options.filePath);
    assertKnownKeys(
      classComposition,
      CLASS_COMPOSITION_KEYS,
      "config.classComposition",
      options.filePath,
    );
  }

  const policy = rawConfig.policy;
  if (policy !== undefined) {
    assertPlainObject(policy, "config.policy", options.filePath);
    assertKnownKeys(policy, POLICY_KEYS, "config.policy", options.filePath);
  }

  const rules = rawConfig.rules;
  if (rules !== undefined) {
    assertPlainObject(rules, "config.rules", options.filePath);
  }

  const resolvedRules = normalizeRules(rules, options.filePath);

  return {
    rootDir:
      normalizeString(rawConfig.rootDir, "config.rootDir", options.filePath) ??
      DEFAULT_CONFIG.rootDir,
    source: {
      include: normalizeStringArray(source?.include, "config.source.include", options.filePath) ?? [
        ...DEFAULT_CONFIG.source.include,
      ],
      exclude: normalizeStringArray(source?.exclude, "config.source.exclude", options.filePath) ?? [
        ...DEFAULT_CONFIG.source.exclude,
      ],
    },
    css: {
      global: normalizeStringArray(css?.global, "config.css.global", options.filePath) ?? [
        ...DEFAULT_CONFIG.css.global,
      ],
      utilities: normalizeStringArray(css?.utilities, "config.css.utilities", options.filePath) ?? [
        ...DEFAULT_CONFIG.css.utilities,
      ],
      modules: {
        enabled:
          normalizeBoolean(cssModules?.enabled, "config.css.modules.enabled", options.filePath) ??
          DEFAULT_CONFIG.css.modules.enabled,
        patterns: normalizeStringArray(
          cssModules?.patterns,
          "config.css.modules.patterns",
          options.filePath,
        ) ?? [...DEFAULT_CONFIG.css.modules.patterns],
      },
    },
    ownership: {
      pagePatterns: normalizeStringArray(
        ownership?.pagePatterns,
        "config.ownership.pagePatterns",
        options.filePath,
      ) ?? [...DEFAULT_CONFIG.ownership.pagePatterns],
      componentCssPatterns: normalizeStringArray(
        ownership?.componentCssPatterns,
        "config.ownership.componentCssPatterns",
        options.filePath,
      ) ?? [...DEFAULT_CONFIG.ownership.componentCssPatterns],
      namingConvention:
        normalizeEnum(
          ownership?.namingConvention,
          OWNERSHIP_NAMING_CONVENTIONS,
          "config.ownership.namingConvention",
          options.filePath,
        ) ?? DEFAULT_CONFIG.ownership.namingConvention,
    },
    externalCss: {
      enabled:
        normalizeBoolean(externalCss?.enabled, "config.externalCss.enabled", options.filePath) ??
        DEFAULT_CONFIG.externalCss.enabled,
      mode:
        normalizeEnum(
          externalCss?.mode,
          EXTERNAL_CSS_MODES,
          "config.externalCss.mode",
          options.filePath,
        ) ?? DEFAULT_CONFIG.externalCss.mode,
    },
    classComposition: {
      helpers: normalizeStringArray(
        classComposition?.helpers,
        "config.classComposition.helpers",
        options.filePath,
      ) ?? [...DEFAULT_CONFIG.classComposition.helpers],
    },
    policy: {
      failOnSeverity:
        normalizeEnum(
          policy?.failOnSeverity,
          FAIL_ON_SEVERITIES,
          "config.policy.failOnSeverity",
          options.filePath,
        ) ?? DEFAULT_CONFIG.policy.failOnSeverity,
    },
    rules: resolvedRules,
  };
}

async function discoverConfigFile(options: {
  configPath?: string;
  cwd: string;
  env: Record<string, string | undefined>;
}): Promise<ResolvedConfigSource | undefined> {
  if (options.configPath) {
    const explicitPath = path.resolve(options.cwd, options.configPath);

    if (!(await fileExists(explicitPath))) {
      throw new ReactCssScannerConfigError(`Explicit config path does not exist: ${explicitPath}`, {
        filePath: explicitPath,
      });
    }

    return {
      kind: "explicit-path",
      filePath: explicitPath,
    };
  }

  const projectRootPath = path.join(options.cwd, CONFIG_FILE_NAME);
  if (await fileExists(projectRootPath)) {
    return {
      kind: "project-root",
      filePath: projectRootPath,
    };
  }

  const envConfigDir = options.env.REACT_CSS_SCANNER_CONFIG_DIR;
  if (envConfigDir) {
    const envConfigPath = path.resolve(options.cwd, envConfigDir, CONFIG_FILE_NAME);
    if (await fileExists(envConfigPath)) {
      return {
        kind: "env-dir",
        filePath: envConfigPath,
      };
    }
  }

  const pathValue = options.env.PATH;
  if (pathValue) {
    for (const entry of pathValue.split(path.delimiter)) {
      if (!entry) {
        continue;
      }

      const candidatePath = path.join(entry, CONFIG_FILE_NAME);
      if (await fileExists(candidatePath)) {
        return {
          kind: "path",
          filePath: candidatePath,
        };
      }
    }
  }

  return undefined;
}

async function readRawConfigFile(filePath: string): Promise<RawReactCssScannerConfig> {
  let rawText: string;

  try {
    rawText = await readFile(filePath, "utf8");
  } catch {
    throw new ReactCssScannerConfigError(`Could not read config file: ${filePath}`, { filePath });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new ReactCssScannerConfigError(`Config file is not valid JSON: ${filePath}`, {
      filePath,
    });
  }

  return parsed as RawReactCssScannerConfig;
}

function normalizeRules(
  rules: RawReactCssScannerConfig["rules"],
  filePath?: string,
): Record<string, RuleConfigValue> {
  const resolvedRules: Record<string, RuleConfigValue> = {};

  for (const [ruleId, defaultValue] of Object.entries(DEFAULT_CONFIG.rules)) {
    resolvedRules[ruleId] = cloneRuleConfigValue(defaultValue);
  }

  if (!rules) {
    return resolvedRules;
  }

  for (const [ruleId, value] of Object.entries(rules)) {
    resolvedRules[ruleId] = normalizeRuleConfigValue(value, `config.rules.${ruleId}`, filePath);
  }

  return resolvedRules;
}

function normalizeRuleConfigValue(
  value: RuleConfigValue,
  valuePath: string,
  filePath?: string,
): RuleConfigValue {
  if (typeof value === "string") {
    const normalizedSeverity = normalizeEnum(value, RULE_SEVERITIES, valuePath, filePath);

    if (!normalizedSeverity) {
      throw new ReactCssScannerConfigError(
        `Expected ${valuePath} to be one of: ${RULE_SEVERITIES.join(", ")}`,
        { filePath, path: valuePath },
      );
    }

    return normalizedSeverity;
  }

  assertPlainObject(value, valuePath, filePath);
  assertKnownKeys(value, RULE_OBJECT_KEYS, valuePath, filePath);

  const severity = normalizeEnum(
    value.severity,
    RULE_SEVERITIES,
    `${valuePath}.severity`,
    filePath,
  );

  if (severity === undefined) {
    throw new ReactCssScannerConfigError(
      `Missing required rule severity at ${valuePath}.severity`,
      { filePath, path: `${valuePath}.severity` },
    );
  }

  const normalizedRule: RuleConfigObject = { severity };

  if (value.threshold !== undefined) {
    normalizedRule.threshold = normalizePositiveInteger(
      value.threshold,
      `${valuePath}.threshold`,
      filePath,
    );
  }

  if (value.minDeclarationOverlap !== undefined) {
    normalizedRule.minDeclarationOverlap = normalizePositiveInteger(
      value.minDeclarationOverlap,
      `${valuePath}.minDeclarationOverlap`,
      filePath,
    );
  }

  if (value.minOccurrences !== undefined) {
    normalizedRule.minOccurrences = normalizePositiveInteger(
      value.minOccurrences,
      `${valuePath}.minOccurrences`,
      filePath,
    );
  }

  if (value.minDeclarations !== undefined) {
    normalizedRule.minDeclarations = normalizePositiveInteger(
      value.minDeclarations,
      `${valuePath}.minDeclarations`,
      filePath,
    );
  }

  return normalizedRule;
}

function cloneResolvedConfig(config: ResolvedReactCssScannerConfig): ResolvedReactCssScannerConfig {
  return {
    rootDir: config.rootDir,
    source: {
      include: [...config.source.include],
      exclude: [...config.source.exclude],
    },
    css: {
      global: [...config.css.global],
      utilities: [...config.css.utilities],
      modules: {
        enabled: config.css.modules.enabled,
        patterns: [...config.css.modules.patterns],
      },
    },
    ownership: {
      pagePatterns: [...config.ownership.pagePatterns],
      componentCssPatterns: [...config.ownership.componentCssPatterns],
      namingConvention: config.ownership.namingConvention,
    },
    externalCss: {
      enabled: config.externalCss.enabled,
      mode: config.externalCss.mode,
    },
    classComposition: {
      helpers: [...config.classComposition.helpers],
    },
    policy: {
      failOnSeverity: config.policy.failOnSeverity,
    },
    rules: Object.fromEntries(
      Object.entries(config.rules).map(([ruleId, value]) => [ruleId, cloneRuleConfigValue(value)]),
    ),
  };
}

function cloneRuleConfigValue(value: RuleConfigValue): RuleConfigValue {
  if (typeof value === "string") {
    return value;
  }

  return { ...value };
}

function normalizeString(value: unknown, valuePath: string, filePath?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new ReactCssScannerConfigError(`Expected ${valuePath} to be a non-empty string`, {
      filePath,
      path: valuePath,
    });
  }

  return value;
}

function normalizeBoolean(
  value: unknown,
  valuePath: string,
  filePath?: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new ReactCssScannerConfigError(`Expected ${valuePath} to be a boolean`, {
      filePath,
      path: valuePath,
    });
  }

  return value;
}

function normalizeStringArray(
  value: unknown,
  valuePath: string,
  filePath?: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ReactCssScannerConfigError(`Expected ${valuePath} to be an array of strings`, {
      filePath,
      path: valuePath,
    });
  }

  return [...value];
}

function normalizePositiveInteger(value: unknown, valuePath: string, filePath?: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ReactCssScannerConfigError(`Expected ${valuePath} to be a positive integer`, {
      filePath,
      path: valuePath,
    });
  }

  return value as number;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  valuePath: string,
  filePath?: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new ReactCssScannerConfigError(
      `Expected ${valuePath} to be one of: ${allowedValues.join(", ")}`,
      { filePath, path: valuePath },
    );
  }

  return value as T;
}

function assertPlainObject(
  value: unknown,
  valuePath: string,
  filePath?: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReactCssScannerConfigError(`Expected ${valuePath} to be an object`, {
      filePath,
      path: valuePath,
    });
  }
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  valuePath: string,
  filePath?: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new ReactCssScannerConfigError(`Unknown config key "${key}" at ${valuePath}`, {
        filePath,
        path: `${valuePath}.${key}`,
      });
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
