import "server-only";
import type { ArtifactStorage } from "@/lib/artifacts/artifact-storage";
import { getSupabaseServer } from "@/lib/supabase-server";

export const supabaseArtifactStorage: ArtifactStorage = {
  name: "supabase-storage",
  kind: "production",
  async put({ bucket, path, body, contentType, overwrite = false }) {
    const result = await getSupabaseServer()
      .storage.from(bucket)
      .upload(path, body, { contentType, upsert: overwrite });
    if (result.error) throw new Error(result.error.message);
  },
  async remove(bucket, paths) {
    const result = await getSupabaseServer().storage.from(bucket).remove(paths);
    if (result.error) throw new Error(result.error.message);
  },
  async createAccessUrl(bucket, path, ttlSeconds) {
    const result = await getSupabaseServer()
      .storage.from(bucket)
      .createSignedUrl(path, ttlSeconds);
    if (result.error || !result.data?.signedUrl) {
      throw new Error(result.error?.message ?? "signed URL response missing url");
    }
    return result.data.signedUrl;
  },
};
