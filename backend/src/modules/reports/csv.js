// CSV serialisation. Cells that start with a formula character are prefixed so that opening the file in
// Excel/Sheets can't execute them (CSV injection). Output has a UTF-8 BOM so Excel reads ₹ and names correctly.
const FORMULA = /^[=+\-@\t\r]/;

export function cell(value, type) {
  if (value == null || value === "") return "";
  let v = value instanceof Date ? value.toISOString() : value;
  if (type === "number" || type === "money")
    v = typeof v === "number" ? String(v) : String(v);
  else v = String(v);
  // Numbers are written as-is (a negative number is not a formula); free text is neutralised.
  if (type !== "number" && type !== "money" && FORMULA.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(columns, rows, { notes = [] } = {}) {
  const head = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) =>
    columns.map((c) => cell(r[c.key], c.type)).join(","),
  );
  const tail = notes.map((n) => cell(`Note: ${n}`));
  return (
    "﻿" +
    [head, ...body, ...(tail.length ? ["", ...tail] : [])].join("\r\n") +
    "\r\n"
  );
}
