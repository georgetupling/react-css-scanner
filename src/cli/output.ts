import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeOutputFile(input: {
  filePath: string;
  content: string;
  overwrite: boolean;
}): Promise<string> {
  const targetPath = input.overwrite
    ? input.filePath
    : await resolveAvailableOutputPath(input.filePath);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, input.content, "utf8");
  return targetPath;
}

async function resolveAvailableOutputPath(filePath: string): Promise<string> {
  if (!(await fileExists(filePath))) {
    return filePath;
  }

  const parsedPath = path.parse(filePath);

  for (let suffix = 1; suffix < 10000; suffix += 1) {
    const candidate = path.join(parsedPath.dir, `${parsedPath.name}-${suffix}${parsedPath.ext}`);
    if (!(await fileExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not find an available output filename for ${filePath}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
