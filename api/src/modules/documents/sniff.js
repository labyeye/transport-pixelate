// Identify allowed upload types from the file's bytes. The client-declared type and extension are ignored.
const startsWith = (b, bytes, off = 0) =>
  bytes.every((v, i) => b[off + i] === v);

export function sniff(buf) {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { mime: "application/pdf", ext: "pdf" };
  if (startsWith(buf, [0xff, 0xd8, 0xff]))
    return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: "image/png", ext: "png" };
  if (
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return { mime: "image/webp", ext: "webp" };
  return null;
}

/** Strip path parts and control characters; used only for display and Content-Disposition. */
export const safeName = (n = "file") =>
  n
    .replace(/^.*[\\/]/, "")
    .replace(/[^\w.\- ()]/g, "_")
    .slice(0, 120) || "file";
