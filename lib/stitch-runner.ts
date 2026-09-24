/**
 * Runs stitching + attribution for an order. Data access is injected so this stays testable.
 */
import { attribute, LOOKBACK_DAYS, type Attribution, type TrackedEvent } from "./attribution";
import { cartVisitorIdFrom, stitch, type StitchMethod } from "./stitch";

export type StitchOrder = {
  id: string;
  created_at: string;
  checkout_token: string | null;
  customer_id: string | null;
  email_hash: string | null;
  note_attributes: { name: string; value: string }[];
};

export type StitchRepo = {
  getOrder: (orderId: string) => Promise<StitchOrder | null>;
  visitorExists: (visitorId: string) => Promise<boolean>;
  visitorForCheckout: (checkoutToken: string) => Promise<string | null>;
  /** Visitor on the most recent other order from the same customer or email. */
  visitorFromHistory: (orderId: string, customerId: string | null, emailHash: string | null) => Promise<string | null>;
  eventsForVisitor: (visitorId: string, from: Date, to: Date) => Promise<TrackedEvent[]>;
  save: (orderId: string, visitorId: string | null, method: StitchMethod, attributions: Attribution[]) => Promise<void>;
  /** Orders with one of these checkout tokens that weren't stitched by cart attribute or checkout token. */
  ordersToRestitch: (checkoutTokens: string[]) => Promise<string[]>;
};

export async function stitchOrder(orderId: string, repo: StitchRepo) {
  const order = await repo.getOrder(orderId);
  if (!order) return null;

  const cartId = cartVisitorIdFrom(order.note_attributes);
  const cartVisitorId = cartId && (await repo.visitorExists(cartId)) ? cartId : null;
  const checkoutVisitorId =
    !cartVisitorId && order.checkout_token ? await repo.visitorForCheckout(order.checkout_token) : null;
  const historyVisitorId =
    !cartVisitorId && !checkoutVisitorId && (order.customer_id || order.email_hash)
      ? await repo.visitorFromHistory(order.id, order.customer_id, order.email_hash)
      : null;

  const { visitorId, method } = stitch({ cartVisitorId, checkoutVisitorId, historyVisitorId });
  const orderAt = new Date(order.created_at);
  const from = new Date(orderAt.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const events = visitorId ? await repo.eventsForVisitor(visitorId, from, orderAt) : [];
  const attributions = attribute(events, orderAt);

  await repo.save(order.id, visitorId, method, attributions);
  return { visitorId, method, attributions };
}

/** A late pixel event may be the missing link for an order that's already in. */
export async function restitchForCheckouts(checkoutTokens: string[], repo: StitchRepo): Promise<number> {
  const tokens = [...new Set(checkoutTokens.filter(Boolean))];
  if (tokens.length === 0) return 0;
  const orderIds = await repo.ordersToRestitch(tokens);
  for (const id of orderIds) await stitchOrder(id, repo);
  return orderIds.length;
}
