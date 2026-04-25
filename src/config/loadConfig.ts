import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ScanDiagnostic } from "../project/types.js";
import type { ResolvedScannerConfig } from "./types.js";
import { cloneScannerConfig, DEFAULT_SCANNER_CONFIG, parseConfig } from "./validation.js";

export { DEFAULT_SCANNER_CONFIG } from "./validation.js";

const CONFIG_FILE_NAME = "scan-react-css.json";
const CONFIG_DIR_ENV_VAR = "SCAN_REACT_CSS_CONFIG_DIR";

export async function loadScannerConfig(input: {
  rootDir: string;
  configBaseDir?: string;
  configPath?: string;
  diagnostics: ScanDiagnostic[];
}): Promise<ResolvedScannerConfig> {
  const configBaseDir = path.resolve(input.configBaseDir ?? input.rootDir);
  const explicitConfigPath = input.configPath
    ? path.resolve(configBaseDir, input.configPath)
    : undefined;

  if (explicitConfigPath) {
    return loadConfigFile({
      absolutePath: explicitConfigPath,
      source: {
        kind: "explicit",
        path: normalizeProjectPath(path.relative(configBaseDir, explicitConfigPath)),
      },
      diagnostics: input.diagnostics,
    });
  }

  const projectConfigPath = path.join(configBaseDir, CONFIG_FILE_NAME);
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
    ...cloneScannerConfig(DEFAULT_SCANNER_CONFIG),
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
      ...cloneScannerConfig(DEFAULT_SCANNER_CONFIG),
      source: input.source,
    };
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

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
