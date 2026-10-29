// WhatsApp / SMS credits for NestTransport. 1 credit ~ Rs 1. Rates/packs/bonus are PLACEHOLDERS - edit here only.
// Balances are stored as integers of 1/UNIT credit so 0.2-credit messages never drift (0.1 + 0.2 != 0.3).
export const creditsConfig = {
  UNIT: 100,
  DEFAULT_RATE: 0.2,
  // credits per external message, by channel. Email is free, in-app is free; only these cost us money.
  RATES: { whatsapp: 0.2, sms: 0.4 },
  GST_PCT: 18,
  // price = what the organization pays before GST (rupees), credits = what it gets
  PACKS: [
    { id: "p500", price: 500, credits: 500 },
    { id: "p1000", price: 1000, credits: 1000 },
    { id: "p2500", price: 2500, credits: 2625 },
    { id: "p5000", price: 5000, credits: 5500 },
  ],
  LOW_BALANCE_CREDITS: 50,
  DAILY_CAP: 3000, // messages per organization per day; a loop/bug can't drain a wallet
  BONUS_DAYS: 90,
  // free credits on a paid plan: 10% of what was paid (rupees), to the nearest 50, between 0 and 1500
  bonusFor: (amountPaid) =>
    Math.min(1500, Math.floor(((amountPaid || 0) * 0.1) / 50) * 50),
};
