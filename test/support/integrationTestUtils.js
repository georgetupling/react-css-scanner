import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

export async function withBuiltProject(builder, run) {
  const project = await builder.build();

  try {
    await run(project);
  } finally {
    await project.cleanup();
  }
}

export async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-css-scanner-test-support-"));

  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
