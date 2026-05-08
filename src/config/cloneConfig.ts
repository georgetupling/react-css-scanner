import type { ExternalCssGlobalProviderConfig, ScannerConfig } from "./types.js";

export function cloneScannerConfig(config: ScannerConfig): ScannerConfig {
  return {
    failOnSeverity: config.failOnSeverity,
    rules: { ...config.rules },
    cssModules: { ...config.cssModules },
    externalCss: cloneExternalCssConfig(config.externalCss),
    ownership: cloneOwnershipConfig(config.ownership),
    discovery: cloneDiscoveryConfig(config.discovery),
    ignore: cloneIgnoreConfig(config.ignore),
    reporting: cloneReportingConfig(config.reporting),
  };
}

export function cloneExternalCssConfig(
  config: ScannerConfig["externalCss"],
): ScannerConfig["externalCss"] {
  return {
    fetchRemote: config.fetchRemote,
    globals: cloneExternalCssGlobals(config.globals),
    remoteTimeoutMs: config.remoteTimeoutMs,
  };
}

export function cloneOwnershipConfig(
  config: ScannerConfig["ownership"],
): ScannerConfig["ownership"] {
  return {
    sharedCss: [...config.sharedCss],
    sharingPolicy: config.sharingPolicy,
  };
}

export function cloneDiscoveryConfig(
  config: ScannerConfig["discovery"],
): ScannerConfig["discovery"] {
  return {
    sourceRoots: [...config.sourceRoots],
    exclude: [...config.exclude],
    publicRoots: [...config.publicRoots],
    aliases: Object.fromEntries(
      Object.entries(config.aliases).map(([key, values]) => [key, [...values]]),
    ),
    stylesheetExtensions: [...config.stylesheetExtensions],
  };
}

export function cloneIgnoreConfig(config: ScannerConfig["ignore"]): ScannerConfig["ignore"] {
  return {
    classNames: [...config.classNames],
    filePaths: [...config.filePaths],
  };
}

export function cloneReportingConfig(
  config: ScannerConfig["reporting"],
): ScannerConfig["reporting"] {
  return {
    verbose: config.verbose,
    json: config.json,
    trace: config.trace,
    debugRuntimeCss: config.debugRuntimeCss,
    outputDirectory: config.outputDirectory,
    overwriteOutput: config.overwriteOutput,
  };
}

export function cloneExternalCssGlobals(
  globals: ExternalCssGlobalProviderConfig[],
): ExternalCssGlobalProviderConfig[] {
  return globals.map((global) => ({
    provider: global.provider,
    match: [...global.match],
    classPrefixes: [...global.classPrefixes],
    classNames: [...global.classNames],
    stylesheetRole: global.stylesheetRole,
  }));
}
