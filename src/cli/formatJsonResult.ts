import type { ScanProjectResult } from "../project/index.js";
import {
  filterDiagnostics,
  filterFindings,
  includeDebugOutput,
  withoutDebugCounts,
} from "./filters.js";

export function formatJsonResult(result: ScanProjectResult): object {
  const includeDebug = includeDebugOutput(result);

  return {
    rootDir: result.rootDir,
    focusPath: result.focusPath,
    config: {
      source: result.config.source,
      failOnSeverity: result.config.failOnSeverity,
      verbosity: result.config.verbosity,
      rules: result.config.rules,
      cssModules: result.config.cssModules,
    },
    diagnostics: filterDiagnostics(result.diagnostics, includeDebug),
    findings: filterFindings(result.findings, includeDebug),
    summary: includeDebug ? result.summary : withoutDebugCounts(result.summary),
    failed: result.failed,
  };
}
