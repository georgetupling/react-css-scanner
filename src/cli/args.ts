import type { RuleSeverity } from "../rules/index.js";
import { CliUsageError, type CliArgs, type CliVerbosity } from "./types.js";

const PLANNED_BUT_UNSUPPORTED_FLAGS = new Set(["--print-config"]);

export function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {
    focusPaths: [],
    outputMinSeverity: "info",
    verbosity: "medium",
    overwriteOutput: false,
    json: false,
    timings: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--timings") {
      args.timings = true;
      continue;
    }

    if (arg === "--config") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--config requires a path value.");
      }

      args.configPath = value;
      index += 1;
      continue;
    }

    if (arg === "--focus") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--focus requires a path or glob value.");
      }

      args.focusPaths.push(...parseFocusValues(value));
      index += 1;
      continue;
    }

    if (arg === "--output-file") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--output-file requires a path value.");
      }

      args.outputFile = value;
      index += 1;
      continue;
    }

    if (arg === "--output-min-severity") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--output-min-severity requires a severity value.");
      }

      if (!isRuleSeverity(value)) {
        throw new CliUsageError(
          '--output-min-severity must be one of "debug", "info", "warn", or "error".',
        );
      }

      args.outputMinSeverity = value;
      index += 1;
      continue;
    }

    if (arg === "--verbosity") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--verbosity requires a value.");
      }

      if (!isCliVerbosity(value)) {
        throw new CliUsageError('--verbosity must be one of "low", "medium", or "high".');
      }

      args.verbosity = value;
      index += 1;
      continue;
    }

    if (arg === "--overwrite-output") {
      args.overwriteOutput = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (PLANNED_BUT_UNSUPPORTED_FLAGS.has(arg)) {
      throw new CliUsageError(`${arg} is recognized, but is not supported in this build yet.`);
    }

    if (arg.startsWith("-")) {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }

    if (!args.rootDir) {
      args.rootDir = arg;
      continue;
    }

    throw new CliUsageError(`Unexpected positional argument: ${arg}`);
  }

  if ((args.outputFile || args.overwriteOutput) && !args.json) {
    throw new CliUsageError("--output-file and --overwrite-output require --json.");
  }

  return args;
}

export function printHelp(stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(
    `Usage: scan-react-css [rootDir] [--config path] [--focus path-or-glob] [--json] [--output-file path] [--overwrite-output] [--output-min-severity severity] [--verbosity low|medium|high] [--timings]\n`,
  );
}

function parseFocusValues(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isRuleSeverity(value: string): value is RuleSeverity {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function isCliVerbosity(value: string): value is CliVerbosity {
  return value === "low" || value === "medium" || value === "high";
}
