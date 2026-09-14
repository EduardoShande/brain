// POST { plan_id } -> creates a QR charge for the signed-in student.
//
// Amount and days come from the plans table on the server, never from the
// request, so a student cannot change what they pay or what they get.

import {
  adminClient,
  assertProviderAllowed,
  corsHeaders,
  errorResponse,
  HttpError,
  json,
  type OrderRow,
  providerFor,
  publicOrder,
  readJson,
  requireUser,
} from "../_shared/payments.ts";

const QR_MINUTES = 20;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = await readJson(req);
    const planId = typeof body.plan_id === "string" ? body.plan_id : "";

    const { data: plan, error: planError } = await admin
      .from("plans")
      .select("id, name, price_bob, days")
      .eq("id", planId)
      .eq("active", true)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) throw new HttpError(400, "That plan is not available.");

    const provider = providerFor(admin);
    await assertProviderAllowed(admin, provider);

    // A double click, or reopening the dialog, reuses a QR that still has
    // time left instead of creating a second order.
    const { data: open, error: openError } = await admin
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .eq("plan_id", plan.id)
      .eq("provider", provider.name)
      .eq("status", "pending")
      .gt("expires_at", new Date(Date.now() + 2 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<OrderRow>();
    if (openError) throw openError;
    if (open?.provider_ref) return json({ order: publicOrder(open), test_mode: provider.isTest });

    const expiresAt = new Date(Date.now() + QR_MINUTES * 60_000);
    const { data: order, error: insertError } = await admin
      .from("orders")
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        amount_bob: plan.price_bob,
        days: plan.days,
        provider: provider.name,
        expires_at: expiresAt.toISOString(),
      })
      .select("*")
      .single<OrderRow>();
    if (insertError) throw insertError;

    let charge;
    try {
      charge = await provider.createCharge({
        orderId: order.id,
        amountBob: Number(plan.price_bob),
        description: `Brain Academy, ${plan.name}`,
        expiresAt,
      });
    } catch (e) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      throw e;
    }

    const { data: ready, error: updateError } = await admin
      .from("orders")
      .update({ provider_ref: charge.providerRef, qr_text: charge.qrText, qr_image: charge.qrImage })
      .eq("id", order.id)
      .select("*")
      .single<OrderRow>();
    if (updateError) throw updateError;

    return json({ order: publicOrder(ready), test_mode: provider.isTest });
  } catch (e) {
    return errorResponse(e);
  }
});
