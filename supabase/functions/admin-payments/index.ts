// POST { action, ... } -> the admin side of manual QR payments.
//
//   list                          orders to review, open QR orders, recent history, the current QR
//   approve { order_id }          the money arrived: mark paid and open access
//   reject  { order_id, note }    no matching payment: close the order with a reason
//   set_qr  { image }             upload the bank QR students pay (data URL, png/jpeg/webp)
//
// Every action checks public.admins by account id first.

import {
  adminClient,
  corsHeaders,
  errorResponse,
  HttpError,
  isUuid,
  json,
  type OrderRow,
  QR_BUCKET,
  QR_PATH,
  readJson,
  RECEIPTS_BUCKET,
  requireAdmin,
} from "../_shared/payments.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

const MAX_QR_BYTES = 2 * 1024 * 1024;
const LINK_SECONDS = 3600;

async function signed(admin: SupabaseClient, bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, LINK_SECONDS);
  return data?.signedUrl ?? null;
}

async function describe(admin: SupabaseClient, orders: OrderRow[]) {
  const ids = [...new Set(orders.map((o) => o.user_id))];
  const people = new Map<string, { email: string | null; name: string | null }>();
  if (ids.length) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
    const names = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string | null]));
    await Promise.all(ids.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      people.set(id, { email: data?.user?.email ?? null, name: names.get(id) ?? null });
    }));
  }
  return Promise.all(orders.map(async (o) => ({
    id: o.id,
    ref_code: o.ref_code,
    status: o.status,
    amount_bob: Number(o.amount_bob),
    plan_id: o.plan_id,
    created_at: o.created_at,
    claimed_at: o.claimed_at,
    paid_at: o.paid_at,
    reviewed_at: o.reviewed_at,
    review_note: o.review_note,
    email: people.get(o.user_id)?.email ?? null,
    name: people.get(o.user_id)?.name ?? null,
    receipt_url: await signed(admin, RECEIPTS_BUCKET, o.receipt_path),
    receipt_is_pdf: !!o.receipt_path && o.receipt_path.toLowerCase().endsWith(".pdf"),
  })));
}

async function list(admin: SupabaseClient) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [review, open, recent, qr] = await Promise.all([
    admin.from("orders").select("*").eq("provider", "manual").eq("status", "review")
      .order("claimed_at", { ascending: true }),
    admin.from("orders").select("*").eq("provider", "manual").in("status", ["pending", "expired"])
      .gt("created_at", weekAgo).order("created_at", { ascending: false }).limit(50),
    admin.from("orders").select("*").eq("provider", "manual").in("status", ["paid", "cancelled"])
      .not("reviewed_at", "is", null).order("reviewed_at", { ascending: false }).limit(20),
    admin.storage.from(QR_BUCKET).list("", { search: QR_PATH, limit: 5 }),
  ]);
  for (const r of [review, open, recent]) if (r.error) throw r.error;
  const hasQr = !!qr.data?.some((f) => f.name === QR_PATH);
  return {
    qr_url: hasQr ? await signed(admin, QR_BUCKET, QR_PATH) : null,
    review: await describe(admin, (review.data ?? []) as OrderRow[]),
    open: await describe(admin, (open.data ?? []) as OrderRow[]),
    recent: await describe(admin, (recent.data ?? []) as OrderRow[]),
  };
}

async function manualOrder(admin: SupabaseClient, id: unknown): Promise<OrderRow> {
  if (!isUuid(id)) throw new HttpError(400, "Missing order.");
  const { data, error } = await admin.from("orders").select("*").eq("id", id).eq("provider", "manual")
    .maybeSingle<OrderRow>();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Order not found.");
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = adminClient();
    const user = await requireAdmin(req, admin);
    const body = await readJson(req);

    switch (body.action) {
      case "list":
        return json(await list(admin));

      case "approve": {
        const order = await manualOrder(admin, body.order_id);
        if (order.status === "cancelled") throw new HttpError(409, "This order was rejected. Ask the student to pay again.");
        if (order.status !== "paid") {
          const { error: rpcError } = await admin.rpc("fulfill_order", { p_order_id: order.id });
          if (rpcError) throw rpcError;
          const { error: markError } = await admin.from("orders")
            .update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id }).eq("id", order.id);
          if (markError) throw markError;
          const { error: eventError } = await admin.from("payment_events").insert({
            provider: "manual", provider_ref: order.provider_ref, order_id: order.id, kind: "fulfilled:admin",
            payload: { admin: user.id },
          });
          if (eventError) console.error("could not record payment event", eventError);
        }
        return json(await list(admin));
      }

      case "reject": {
        const order = await manualOrder(admin, body.order_id);
        if (order.status === "paid") throw new HttpError(409, "This order is already paid.");
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
        const { error: updateError } = await admin.from("orders")
          .update({
            status: "cancelled",
            review_note: note || null,
            reviewed_at: new Date().toISOString(),
            reviewed_by: user.id,
          })
          .eq("id", order.id);
        if (updateError) throw updateError;
        const { error: eventError } = await admin.from("payment_events").insert({
          provider: "manual", provider_ref: order.provider_ref, order_id: order.id, kind: "rejected",
          payload: { admin: user.id, note },
        });
        if (eventError) console.error("could not record payment event", eventError);
        return json(await list(admin));
      }

      case "set_qr": {
        const m = typeof body.image === "string"
          ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image)
          : null;
        if (!m) throw new HttpError(400, "Upload a PNG, JPG or WEBP image of your QR.");
        const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        if (bytes.length > MAX_QR_BYTES) throw new HttpError(400, "The image is too large. Use one under 2 MB.");
        const { error: upError } = await admin.storage.from(QR_BUCKET)
          .upload(QR_PATH, bytes, { contentType: m[1], upsert: true, cacheControl: "60" });
        if (upError) throw upError;
        return json(await list(admin));
      }

      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (e) {
    return errorResponse(e);
  }
});
