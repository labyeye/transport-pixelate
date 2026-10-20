export const daysUntil = (iso) =>
  Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
