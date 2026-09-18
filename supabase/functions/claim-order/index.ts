// POST { order_id, receipt_path } -> the student says "I paid" and attaches
// the receipt they uploaded to the receipts bucket.
//
// This never grants access. It only moves the order to 'review', where an
// admin compares it with the money that arrived in the bank account.

import {
  adminClient,
  corsHeaders,
  errorResponse,
  HttpError,
  isUuid,
  json,
  type OrderRow,
  publicOrder,
  readJson,
  RECEIPTS_BUCKET,
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
    const path = typeof body.receipt_path === "string" ? body.receipt_path : "";

    const { data: order, error } = await admin
      .from("orders")
      .select("*")
      .eq("id", body.order_id)
      .eq("user_id", user.id)
      .eq("provider", "manual")
      .maybeSingle<OrderRow>();
    if (error) throw error;
    if (!order) throw new HttpError(404, "Order not found.");
    if (order.status === "paid" || order.status === "review") return json({ order: publicOrder(order) });
    // a late payment on an expired QR still counts: the money arrived
    if (order.status !== "pending" && order.status !== "expired") {
      throw new HttpError(409, "This payment was closed. Start a new one.");
    }

    // the file must sit in this student's own folder, named after this order
    const folder = `${user.id}`;
    const prefix = `${order.id}.`;
    if (!path.startsWith(`${folder}/${prefix}`) || path.includes("..") || path.length > 200) {
      throw new HttpError(400, "Upload the receipt again.");
    }
    const { data: files, error: listError } = await admin.storage
      .from(RECEIPTS_BUCKET)
      .list(folder, { search: prefix, limit: 10 });
    if (listError) throw listError;
    if (!files?.some((f) => `${folder}/${f.name}` === path)) {
      throw new HttpError(400, "We could not find your receipt. Upload it again.");
    }

    const { data: claimed, error: updateError } = await admin
      .from("orders")
      .update({ status: "review", receipt_path: path, claimed_at: new Date().toISOString(), review_note: null })
      .eq("id", order.id)
      .in("status", ["pending", "expired"])
      .select("*")
      .maybeSingle<OrderRow>();
    if (updateError) throw updateError;

    const { error: eventError } = await admin.from("payment_events").insert({
      provider: "manual",
      provider_ref: order.provider_ref,
      order_id: order.id,
      kind: "claimed",
    });
    if (eventError) console.error("could not record payment event", eventError);

    return json({ order: publicOrder(claimed ?? order) });
  } catch (e) {
    return errorResponse(e);
  }
});
