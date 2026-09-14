// POST { order_id } -> simulates paying a test-provider QR.
//
// Three locks, all required: payment_mode is 'test', the caller is in
// public.admins (by account id), and the order is the caller's own. It then
// goes through the same confirm-and-fulfil path a real payment uses.

import {
  accessUntil,
  adminClient,
  confirmAndFulfill,
  corsHeaders,
  errorResponse,
  HttpError,
  isUuid,
  json,
  MockProvider,
  type OrderRow,
  paymentMode,
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

    if ((await paymentMode(admin)) !== "test") throw new HttpError(403, "Test payments are turned off.");

    const { data: isAdmin, error: adminError } = await admin
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!isAdmin) throw new HttpError(403, "Only academy admins can simulate a payment.");

    const body = await readJson(req);
    if (!isUuid(body.order_id)) throw new HttpError(400, "Missing order.");

    const { data: order, error } = await admin
      .from("orders")
      .select("*")
      .eq("id", body.order_id)
      .eq("user_id", user.id)
      .eq("provider", "mock")
      .maybeSingle<OrderRow>();
    if (error) throw error;
    if (!order?.provider_ref) throw new HttpError(404, "Order not found.");

    const { error: markError } = await admin
      .from("mock_charges")
      .update({ status: "paid" })
      .eq("provider_ref", order.provider_ref);
    if (markError) throw markError;

    const result = await confirmAndFulfill(admin, new MockProvider(admin), order.provider_ref, "mock-pay");
    return json({ order: publicOrder(result.order ?? order), access_until: await accessUntil(admin, user.id) });
  } catch (e) {
    return errorResponse(e);
  }
});
