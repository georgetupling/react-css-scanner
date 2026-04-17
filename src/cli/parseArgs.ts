import type { FindingSeverity } from "../runtime/types.js";
import type { ConfigSummaryMode, HumanOutputMode } from "./format.js";

export type ParsedCliArgs = {
  targetPath?: string;
  focusPath?: string;
  configPath?: string;
  json: boolean;
  outputMinSeverity?: FindingSeverity;
  outputFile?: string;
  overwriteOutput: boolean;
  configSummary: ConfigSummaryMode;
  outputMode: HumanOutputMode;
};

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

const SEVERITIES: FindingSeverity[] = ["info", "warning", "error"];
const CONFIG_SUMMARY_MODES: ConfigSummaryMode[] = ["off", "default", "verbose"];
const OUTPUT_MODES: HumanOutputMode[] = ["minimal", "default", "verbose"];

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2);
  const parsed: ParsedCliArgs = {
    json: false,
    overwriteOutput: false,
    configSummary: "default",
    outputMode: "default",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("-")) {
      if (parsed.targetPath) {
        throw new CliArgumentError(`Unexpected extra positional argument: ${arg}`);
      }

      parsed.targetPath = arg;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--overwrite-output") {
      parsed.overwriteOutput = true;
      continue;
    }

    if (arg === "--config") {
      parsed.configPath = readNextValue(args, ++index, "--config");
      continue;
    }

    if (arg === "--focus") {
      parsed.focusPath = readNextValue(args, ++index, "--focus");
      continue;
    }

    if (arg === "--output-min-severity") {
      const value = readNextValue(args, ++index, "--output-min-severity");
      if (!SEVERITIES.includes(value as FindingSeverity)) {
        throw new CliArgumentError(
          `Invalid value for --output-min-severity: ${value}. Expected one of ${SEVERITIES.join(", ")}`,
        );
      }
      parsed.outputMinSeverity = value as FindingSeverity;
      continue;
    }

    if (arg === "--output-file") {
      parsed.outputFile = readNextValue(args, ++index, "--output-file");
      continue;
    }

    if (arg === "--config-summary") {
      const value = readNextValue(args, ++index, "--config-summary");
      if (!CONFIG_SUMMARY_MODES.includes(value as ConfigSummaryMode)) {
        throw new CliArgumentError(
          `Invalid value for --config-summary: ${value}. Expected one of ${CONFIG_SUMMARY_MODES.join(", ")}`,
        );
      }
      parsed.configSummary = value as ConfigSummaryMode;
      continue;
    }

    if (arg === "--output-mode") {
      const value = readNextValue(args, ++index, "--output-mode");
      if (!OUTPUT_MODES.includes(value as HumanOutputMode)) {
        throw new CliArgumentError(
          `Invalid value for --output-mode: ${value}. Expected one of ${OUTPUT_MODES.join(", ")}`,
        );
      }
      parsed.outputMode = value as HumanOutputMode;
      continue;
    }

    throw new CliArgumentError(`Unknown CLI flag: ${arg}`);
  }

  if (parsed.outputFile && !parsed.json) {
    throw new CliArgumentError("--output-file requires --json");
  }

  if (parsed.outputMinSeverity && parsed.json) {
    throw new CliArgumentError("--output-min-severity only applies to human-readable output");
  }

  return parsed;
}

function readNextValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    throw new CliArgumentError(`Missing value for ${flag}`);
  }

  return value;
}
