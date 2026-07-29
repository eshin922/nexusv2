import "server-only";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ArtifactStorage } from "@/lib/artifacts/artifact-storage";
import { isLoopbackNetworkUrl } from "@/lib/config/runtime-config";

function artifactRoot(): string {
  const configured = process.env.NEXUS_VALIDATION_ARTIFACT_ROOT;
  if (!configured) {
    throw new Error("[local-artifacts] NEXUS_VALIDATION_ARTIFACT_ROOT is required");
  }
  const root = resolve(configured);
  const expected = `${sep}.artifacts${sep}validation${sep}`;
  if (!`${root}${sep}`.includes(expected)) {
    throw new Error("[local-artifacts] root must be under .artifacts/validation");
  }
  return root;
}

function safeTarget(bucket: string, path: string): string {
  const root = artifactRoot();
  const target = resolve(root, bucket, path);
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error("[local-artifacts] path escapes validation artifact root");
  }
  return target;
}

export const localArtifactStorage: ArtifactStorage = {
  name: "local-filesystem",
  kind: "isolated",
  async put({ bucket, path, body, overwrite = false }) {
    const target = safeTarget(bucket, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(body), {
      flag: overwrite ? "w" : "wx",
    });
  },
  async remove(bucket, paths) {
    for (const path of paths) await rm(safeTarget(bucket, path), { force: true });
  },
  async createAccessUrl(bucket, path) {
    const configured = process.env.NEXUS_VALIDATION_ARTIFACT_ORIGIN;
    if (!configured || !isLoopbackNetworkUrl(configured)) {
      throw new Error("[local-artifacts] origin must be an explicit loopback URL");
    }
    const url = new URL(configured);
    url.pathname = [url.pathname.replace(/\/$/, ""), bucket, path]
      .join("/")
      .replace(/\/+/g, "/");
    return url.toString();
  },
};
