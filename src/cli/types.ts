import type { RuleSeverity } from "../rules/index.js";

export type CliArgs = {
  rootDir?: string;
  configPath?: string;
  focusPaths: string[];
  outputMinSeverity: RuleSeverity;
  verbose: boolean;
  trace: boolean;
  debugRuntimeCss: boolean;
  outputFile?: string;
  overwriteOutput: boolean;
  ignoreClassNames: string[];
  ignoreFilePaths: string[];
  json: boolean;
  timings: boolean;
  help: boolean;
};

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}
