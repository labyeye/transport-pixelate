// Per active vehicle per month, integer paise, GST added on top. Yearly = 12x monthly (no discount).
// ponytail: placeholder rates, override with PRICE_BASIC_PAISE / PRICE_PRO_PAISE until final pricing is agreed.
export const TIERS = {
  basic: {
    label: "Web + Mobile",
    rate: () => Number(process.env.PRICE_BASIC_PAISE ?? 15000),
  },
  pro: {
    label: "Web + Mobile + WhatsApp + Fee billing",
    rate: () => Number(process.env.PRICE_PRO_PAISE ?? 25000),
  },
};
export const GST_RATE = 18;
export const TRIAL_DAYS = () => Number(process.env.TRIAL_DAYS ?? 30);
export const TRIAL_VEHICLES = () => Number(process.env.TRIAL_VEHICLES ?? 10);
export const GRACE_DAYS = 3;

// Which optional modules / channels a tier unlocks (anything not listed is open to every tier).
export const FEATURES = {
  basic: { whatsapp: false, billing: false, parentAccess: false, alerts: false },
  pro: { whatsapp: true, billing: true, parentAccess: true, alerts: true },
};

/** `offer` is an OfferCode-like object; flat_rate/percent_off change the amount, bonus_months extends the term. */
export function calculatePricing(
  vehicles,
  tier,
  billingCycle = "monthly",
  offer = null,
) {
  if (!TIERS[tier]) throw new Error(`Unknown tier: ${tier}`);
  let rate = TIERS[tier].rate();
  if (offer?.discountType === "flat_rate" && offer.flatRate)
    rate = offer.flatRate;
  let monthly = vehicles * rate;
  if (offer?.discountType === "percent_off" && offer.percentOff)
    monthly = Math.round(monthly * (1 - offer.percentOff / 100));
  const subtotal = billingCycle === "yearly" ? monthly * 12 : monthly;
  const gstAmount = Math.round((subtotal * GST_RATE) / 100);
  return {
    rate,
    gstRate: GST_RATE,
    subtotal,
    gstAmount,
    total: subtotal + gstAmount,
    bonusMonths: offer?.discountType === "bonus_months" ? offer.bonusMonths : 0,
  };
}
