// File storage adapter. Local disk today; implement the same four functions to move to S3/GCS.
// Files are never served by a static route: every download goes through an authorized API handler.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = () =>
  path.resolve(process.env.UPLOAD_DIR ?? path.join(here, "../../../uploads"));

export async function put(org, buffer) {
  const key = `${org}/${crypto.randomBytes(16).toString("hex")}`; // random name; user filename is never used on disk
  const full = path.join(root(), key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buffer, { flag: "wx", mode: 0o600 });
  return key;
}

const resolveKey = (key) => {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep))
    throw new Error("Invalid storage key"); // path traversal guard
  return full;
};

export const stream = (key) => fs.createReadStream(resolveKey(key));
export const exists = (key) =>
  fs.promises.access(resolveKey(key)).then(
    () => true,
    () => false,
  );
export const remove = (key) => fs.promises.rm(resolveKey(key), { force: true });
