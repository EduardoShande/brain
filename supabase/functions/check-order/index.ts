// POST { order_id } -> current status of the student's own order.
//
// The checkout screen polls this while the QR is on screen. While an order
// is open it also asks the provider directly, so a lost webhook never
// leaves a student who paid waiting.

import {
  accessUntil,
  adminClient,
  confirmAndFulfill,
  corsHeaders,
  errorResponse,
  HttpError,
  isUuid,
  json,
  type OrderRow,
  providerFor,
  publicOrder,
  readJson,
  requireUser,
} from "../_shared/payments.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = await readJson(req);
    if (!isUuid(body.order_id)) throw new HttpError(400, "Missing order.");

    const { data: order, error } = await admin
      .from("orders")
      .select("*")
      .eq("id", body.order_id)
      .eq("user_id", user.id)
      .maybeSingle<OrderRow>();
    if (error) throw error;
    if (!order) throw new HttpError(404, "Order not found.");

    let current = order;
    // the manual provider cannot be asked; an admin approves those orders
    if ((order.status === "pending" || order.status === "expired") && order.provider_ref && order.provider !== "manual") {
      const result = await confirmAndFulfill(admin, providerFor(admin, order.provider), order.provider_ref, "check");
      if (result.order) current = result.order;
    }

    if (current.status === "pending" && new Date(current.expires_at).getTime() < Date.now()) {
      const { data: expired, error: expireError } = await admin
        .from("orders")
        .update({ status: "expired" })
        .eq("id", current.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle<OrderRow>();
      if (expireError) throw expireError;
      if (expired) current = expired;
    }

    return json({ order: publicOrder(current), access_until: await accessUntil(admin, user.id) });
  } catch (e) {
    return errorResponse(e);
  }
});
