import path from "node:path";

export function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function resolveRootDir(rootDir: string | undefined): string {
  return path.resolve(rootDir ?? process.cwd());
}

export function resolveProjectFile(rootDir: string, filePath: string): ProjectResolvedPath {
  const absolutePath = path.resolve(rootDir, filePath);
  return {
    absolutePath,
    filePath: normalizeProjectPath(path.relative(rootDir, absolutePath)),
  };
}

export type ProjectResolvedPath = {
  absolutePath: string;
  filePath: string;
};
