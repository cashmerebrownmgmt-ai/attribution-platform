/**
 * Order → visitor stitching. Pure: the caller looks up the candidates.
 * See docs/phase-1-spec.md §6.
 */
import { CART_ATTRIBUTE } from "../tracker/core";

export type StitchMethod = "cart_attribute" | "checkout_token" | "customer_history" | "none";

export type StitchCandidates = {
  /** Visitor ID from the order's _ap_vid note attribute, if that visitor exists. */
  cartVisitorId: string | null;
  /** Visitor on a pixel event with the order's checkout token. */
  checkoutVisitorId: string | null;
  /** Visitor already stitched to an earlier order from the same customer or email. */
  historyVisitorId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The visitor ID the tracker wrote onto the cart, if present and well-formed. */
export function cartVisitorIdFrom(noteAttributes: { name: string; value: string }[] | null | undefined): string | null {
  const value = noteAttributes?.find((a) => a.name === CART_ATTRIBUTE)?.value?.trim().toLowerCase();
  return value && UUID_RE.test(value) ? value : null;
}

export function stitch(c: StitchCandidates): { visitorId: string | null; method: StitchMethod } {
  if (c.cartVisitorId) return { visitorId: c.cartVisitorId, method: "cart_attribute" };
  if (c.checkoutVisitorId) return { visitorId: c.checkoutVisitorId, method: "checkout_token" };
  if (c.historyVisitorId) return { visitorId: c.historyVisitorId, method: "customer_history" };
  return { visitorId: null, method: "none" };
}
