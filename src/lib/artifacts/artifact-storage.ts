export const QUOTE_ATTACHMENTS_BUCKET = "quote-attachments";
export const QUOTE_PDFS_BUCKET = "quote-pdfs";

export type ArtifactWrite = {
  bucket: string;
  path: string;
  body: ArrayBuffer | Uint8Array;
  contentType: string;
  overwrite?: boolean;
};

export interface ArtifactStorage {
  readonly name: string;
  readonly kind: "production" | "isolated";
  put(input: ArtifactWrite): Promise<void>;
  remove(bucket: string, paths: string[]): Promise<void>;
  createAccessUrl(
    bucket: string,
    path: string,
    ttlSeconds: number,
  ): Promise<string>;
}

export function buildAttachmentStoragePath(
  quoteId: string,
  uuid: string,
  filename: string,
): string {
  const safe = filename.replace(/[/\\\x00-\x1F\x7F]/g, "_");
  return `${quoteId}/${uuid}-${safe}`;
}

export function buildQuotePdfStoragePath(
  quoteId: string,
  sendUuid: string,
): string {
  return `${quoteId}/${sendUuid}.pdf`;
}
