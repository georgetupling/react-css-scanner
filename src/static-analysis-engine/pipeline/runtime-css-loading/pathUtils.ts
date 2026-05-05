export function normalizeProjectPath(filePath: string): string {
  return filePath
    .split("\\")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

export function getBaseName(filePath: string): string {
  return normalizeProjectPath(filePath).split("/").at(-1) ?? filePath;
}
