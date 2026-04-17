import { stat } from "node:fs/promises";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile();
  } catch {
    return false;
  }
}

export async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    const fileStats = await stat(directoryPath);
    return fileStats.isDirectory();
  } catch {
    return false;
  }
}
