import { Router } from "express";
import { z } from "zod";
import { protect } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, forbidden, notFound } from "../../utils/errors.js";
import { can } from "../../utils/permissions.js";
import { Organization } from "../../models/Organization.js";
import { audit } from "../../models/AuditLog.js";
import { dateInZone } from "../../utils/time.js";
import { toCsv } from "./csv.js";
import { REPORTS } from "./reports.service.js";

const r = Router();
r.use(protect);
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Invalid date",
  ); // rejects 2030-02-30
const MAX_DAYS = 366;
const JSON_CAP = 20000; // list reports stop here and say so
const CSV_CAP = 50000;

const query = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  withinDays: z.coerce.number().int().min(1).max(730).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

async function allowed(req, def) {
  if (
    !can(req.user.role, "reports:read") ||
    !def.needs.every((p) => can(req.user.role, p))
  )
    return false;
  if (def.module) {
    const org = await Organization.findById(req.user.organization).select(
      "modules",
    );
    if (!org?.modules?.[def.module]) return false;
  }
  return true;
}

async function context(req, def, cap) {
  const org = await Organization.findById(req.user.organization).select(
    "timezone",
  );
  const tz = org.timezone;
  const today = dateInZone(new Date(), tz);
  const to = req.query.to ?? today;
  const from =
    req.query.from ?? dateInZone(new Date(Date.now() - 29 * 86400000), tz);
  if (to < from) throw badRequest("'to' is before 'from'");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > MAX_DAYS)
    throw badRequest(`Choose a range of at most ${MAX_DAYS} days`);
  return {
    org: req.user.organization,
    tz,
    from,
    to,
    cap,
    withinDays: req.query.withinDays,
  };
}

async function load(req, cap) {
  const def = REPORTS[req.params.key];
  if (!def) throw notFound("Unknown report");
  if (!(await allowed(req, def)))
    throw forbidden("You don't have access to this report");
  const ctx = await context(req, def, cap);
  const out = await def.run(ctx);
  return { def, ctx, out };
}

r.get(
  "/",
  ah(async (req, res) => {
    const list = [];
    for (const [key, def] of Object.entries(REPORTS))
      if (await allowed(req, def))
        list.push({
          key,
          label: def.label,
          group: def.group,
          usesDateRange: !def.noRange,
        });
    res.json({ success: true, data: list });
  }),
);

r.get(
  "/:key",
  validate(query, "query"),
  ah(async (req, res) => {
    const { def, ctx, out } = await load(req, JSON_CAP);
    const { page, limit } = req.query;
    res.json({
      success: true,
      data: {
        key: req.params.key,
        label: def.label,
        range: def.noRange
          ? null
          : { from: ctx.from, to: ctx.to, timezone: ctx.tz },
        columns: out.columns,
        rows: out.rows.slice((page - 1) * limit, page * limit),
        totals: out.totals ?? null,
        notes: out.notes ?? [],
        truncated: !!out.truncated,
        generatedAt: new Date(),
      },
      meta: {
        page,
        limit,
        total: out.rows.length,
        pages: Math.max(1, Math.ceil(out.rows.length / limit)),
      },
    });
  }),
);

r.get(
  "/:key/export.csv",
  validate(query, "query"),
  ah(async (req, res) => {
    const { def, ctx, out } = await load(req, CSV_CAP);
    const rows = out.totals ? [...out.rows, out.totals] : out.rows;
    const notes = [
      ...(out.notes ?? []),
      ...(out.truncated
        ? [`Output stopped at ${CSV_CAP} rows; narrow the date range.`]
        : []),
      `Generated ${new Date().toISOString()}${def.noRange ? "" : ` for ${ctx.from} to ${ctx.to} (${ctx.tz})`}`,
    ];
    await audit(req, "report.export", "Report", req.params.key, {
      from: ctx.from,
      to: ctx.to,
      rows: rows.length,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.key}${def.noRange ? "" : `_${ctx.from}_${ctx.to}`}.csv"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(toCsv(out.columns, rows, { notes }));
  }),
);

export default r;
