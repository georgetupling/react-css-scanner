import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuleSeverity } from "../rules/index.js";
import type { ScanProjectResult } from "../project/index.js";
import { formatJsonResult } from "./formatter.js";

export async function writeJsonReport(input: {
  result: ScanProjectResult;
  outputFile?: string;
  overwriteOutput: boolean;
  outputMinSeverity: RuleSeverity;
}): Promise<string> {
  const requestedPath = path.resolve(input.outputFile ?? getDefaultJsonReportPath());
  const outputPath = input.overwriteOutput
    ? requestedPath
    : await findAvailableOutputPath(requestedPath);
  const outputDirectory = path.dirname(outputPath);
  const json = `${JSON.stringify(formatJsonResult(input.result, input.outputMinSeverity), null, 2)}\n`;

  try {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, json, {
      flag: input.overwriteOutput ? "w" : "wx",
    });
  } catch (error) {
    throw new Error(
      `Failed to write JSON report to ${outputPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return outputPath;
}

function getDefaultJsonReportPath(date = new Date()): string {
  return path.join("scan-react-css-reports", `report-${formatReportTimestamp(date)}.json`);
}

function formatReportTimestamp(date: Date): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];

  const [year, ...rest] = parts;
  return [String(year), ...rest.map((part) => String(part).padStart(2, "0"))].join("-");
}

async function findAvailableOutputPath(requestedPath: string): Promise<string> {
  if (!(await pathExists(requestedPath))) {
    return requestedPath;
  }

  const parsed = path.parse(requestedPath);
  for (let index = 1; ; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
