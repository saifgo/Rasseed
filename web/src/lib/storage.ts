import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage");
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export async function saveProof(file: File) {
  const ext = ALLOWED[file.type];
  if (!ext) throw new Error("unsupported_file_type");
  if (file.size > MAX_PROOF_BYTES) throw new Error("file_too_large");
  const dir = path.join(root, "proofs");
  await mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return { proofPath: `proofs/${name}`, proofMime: file.type };
}

export async function readProof(relative: string) {
  const full = path.resolve(/*turbopackIgnore: true*/ root, relative);
  if (!full.startsWith(root + path.sep)) throw new Error("invalid_path");
  return readFile(full);
}
