/**
 * Renewal prices normalised to CNY. The hub stores each node's price in its own
 * currency; the design's summary and renewal rows are in yuan, so foreign prices
 * convert at fixed reference rates (2026-11-03 interbank mid rates, the same
 * figures the approved prototype used). Update the table by hand when it drifts
 * far enough to matter; a live FX feed is not worth a runtime dependency for a
 * status page.
 */
export const CNY_RATES: Record<string, number> = {
  CNY: 1,
  USD: 6.67,
  EUR: 7.47,
  GBP: 8.95,
}

/** Yuan value of `amount` in `currency`, or null for a currency with no rate. */
export function toCNY(amount: number, currency: string): number | null {
  const rate = CNY_RATES[currency]
  return rate === undefined ? null : amount * rate
}

const NAMED_MONTHS: Record<string, number> = {
  monthly: 1, quarterly: 3, semiannual: 6, yearly: 12, biennial: 24, triennial: 36,
}

/** Months in a billing cycle, null for a one-off payment or an unknown cycle. */
export function cycleMonths(billing: string): number | null {
  if (billing === "once") return null
  const named = NAMED_MONTHS[billing]
  if (named !== undefined) return named
  const custom = /^(\d+)m$/.exec(billing)
  return custom ? Number(custom[1]) : null
}

/** Yuan per month for a node, for the fleet total: one-off prices are not a monthly cost. */
export function monthlyCNY(price: number, currency: string, billing: string): number | null {
  if (price <= 0) return null
  const yuan = toCNY(price, currency)
  const months = cycleMonths(billing)
  return yuan === null || months === null ? null : yuan / months
}
