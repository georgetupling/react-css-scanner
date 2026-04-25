#!/usr/bin/env node
import { formatJsonResult } from "./cli/formatJsonResult.js";
import { formatTextResult } from "./cli/formatTextResult.js";
import { scanProject } from "./project/index.js";

type CliArgs = {
  rootDir?: string;
  focusPath?: string;
  configPath?: string;
  json: boolean;
  help: boolean;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const result = await scanProject({
  rootDir: args.rootDir,
  focusPath: args.focusPath,
  configPath: args.configPath,
});

if (args.json) {
  console.log(JSON.stringify(formatJsonResult(result), null, 2));
} else {
  console.log(formatTextResult(result));
}

process.exit(result.failed ? 1 : 0);

function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {
    json: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--config") {
      args.configPath = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--focus") {
      args.focusPath = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (!args.rootDir) {
      args.rootDir = arg;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`Usage: scan-react-css [rootDir] [--config path] [--focus path] [--json]`);
}
