import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCli(args, cwd) {
  return runCliWithOptions(args, cwd, {});
}

export async function runCliWithOptions(args, cwd, options) {
  try {
    const result = await execFileAsync(process.execPath, [path.resolve("dist/cli.js"), ...args], {
      cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });

    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}
