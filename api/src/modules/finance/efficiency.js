const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Measured fuel efficiency from fuel logs sorted by time: km between two consecutive FULL-tank fills
 * divided by all litres added after the first of them. Never estimated; partial intervals are skipped.
 */
export function computeEfficiency(logs) {
  const intervals = [];
  let anchor = null;
  let litres = 0;
  for (const l of logs) {
    if (anchor) litres += l.quantity;
    if (!l.fullTank) continue;
    if (anchor) {
      const km = l.odometer - anchor.odometer;
      if (km > 0 && litres > 0)
        intervals.push({
          from: anchor.filledAt,
          to: l.filledAt,
          km,
          litres: round2(litres),
          kmPerUnit: round2(km / litres),
        });
    }
    anchor = l;
    litres = 0;
  }
  const km = intervals.reduce((a, b) => a + b.km, 0);
  const l = intervals.reduce((a, b) => a + b.litres, 0);
  return {
    intervals,
    km,
    litres: round2(l),
    averageKmPerUnit: l ? round2(km / l) : null,
  };
}
