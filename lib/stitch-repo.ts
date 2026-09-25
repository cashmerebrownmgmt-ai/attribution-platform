import type { TrackedEvent } from "./attribution";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StitchRepo } from "./stitch-runner";

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return res.data;
}

const EVENT_COLUMNS =
  "id, session_id, source, occurred_at, is_touchpoint, utm_source, utm_medium, gclid, fbclid, ttclid, msclkid, referrer";

/** Supabase-backed data access for stitching, for any client (server or script). */
export function makeStitchRepo(db: () => SupabaseClient): StitchRepo {
  return {
  async getOrder(orderId) {
    return check(
      await db()
        .from("orders")
        .select("id, created_at, checkout_token, customer_id, email_hash, note_attributes")
        .eq("id", orderId)
        .maybeSingle(),
      "getOrder",
    );
  },

  async visitorExists(visitorId) {
    const data = check(await db().from("visitors").select("id").eq("id", visitorId).maybeSingle(), "visitorExists");
    return data !== null;
  },

  async visitorForCheckout(checkoutToken) {
    const data = check(
      await db()
        .from("events")
        .select("visitor_id")
        .eq("checkout_token", checkoutToken)
        .order("occurred_at", { ascending: true })
        .limit(1),
      "visitorForCheckout",
    );
    return data?.[0]?.visitor_id ?? null;
  },

  async visitorFromHistory(orderId, customerId, emailHash) {
    // Values go into a PostgREST filter string, so keep only characters they can legitimately contain.
    const filters = [
      customerId ? `customer_id.eq.${customerId.replace(/[^0-9A-Za-z_-]/g, "")}` : null,
      emailHash ? `email_hash.eq.${emailHash.replace(/[^0-9a-f]/g, "")}` : null,
    ].filter(Boolean);
    if (filters.length === 0) return null;
    const data = check(
      await db()
        .from("orders")
        .select("visitor_id")
        .neq("id", orderId)
        .not("visitor_id", "is", null)
        .or(filters.join(","))
        .order("created_at", { ascending: false })
        .limit(1),
      "visitorFromHistory",
    );
    return data?.[0]?.visitor_id ?? null;
  },

  async eventsForVisitor(visitorId, from, to) {
    const data = check(
      await db()
        .from("events")
        .select(EVENT_COLUMNS)
        .eq("visitor_id", visitorId)
        .eq("source", "tracker")
        .gte("occurred_at", from.toISOString())
        .lte("occurred_at", to.toISOString())
        .order("occurred_at", { ascending: true })
        .limit(5000),
      "eventsForVisitor",
    );
    return data as TrackedEvent[];
  },

  async save(orderId, visitorId, method, attributions) {
    const { error } = await db().rpc("save_stitch", {
      p_order_id: orderId,
      p_visitor_id: visitorId,
      p_method: method,
      p_attributions: attributions,
    });
    if (error) throw new Error(`save_stitch failed: ${error.message}`);
  },

  async ordersToRestitch(checkoutTokens) {
    const data = check(
      await db()
        .from("orders")
        .select("id")
        .in("checkout_token", checkoutTokens)
        .in("stitch_method", ["none", "customer_history"]),
      "ordersToRestitch",
    );
    return (data ?? []).map((r) => r.id as string);
  },
  };
}
