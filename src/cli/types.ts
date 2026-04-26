import type { RuleSeverity } from "../rules/index.js";

export type CliVerbosity = "low" | "medium" | "high";

export type CliArgs = {
  rootDir?: string;
  configPath?: string;
  focusPaths: string[];
  outputMinSeverity: RuleSeverity;
  verbosity: CliVerbosity;
  outputFile?: string;
  overwriteOutput: boolean;
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
