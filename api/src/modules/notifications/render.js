// {{var}} substitution into plain text. Values are stringified and stripped of control characters;
// nothing is interpreted as HTML or code.
export function render(template, vars = {}) {
  return String(template ?? "")
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
      String(vars[k] ?? "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim(),
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}
export const maskTo = (to = "") =>
  to.includes("@")
    ? to.replace(/^(.{2}).*(@.*)$/, "$1***$2")
    : to.replace(/.(?=.{3})/g, "*");
