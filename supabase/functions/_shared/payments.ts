// Shared code for the payment Edge Functions.
//
// Rule this module enforces: an order is only ever marked paid after the
// payment provider itself confirms it. A webhook body or a client request
// can say "paid", but access is granted on the provider's word alone.

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.116.0";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: "Something went wrong. Please try again." }, 500);
}

// ------------------------------------------------------------------ clients

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  let key: string | undefined;
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      key = JSON.parse(secretKeys)["default"];
    } catch {
      // fall back to the legacy variable below
    }
  }
  key = key ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase credentials are missing from the function environment");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireUser(req: Request, admin: SupabaseClient): Promise<User> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Sign in to continue.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has expired. Sign in again.");
  return data.user;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// ------------------------------------------------------------------ orders

export type OrderRow = {
  id: string;
  user_id: string;
  plan_id: string;
  amount_bob: number | string;
  days: number;
  status: "pending" | "paid" | "expired" | "cancelled";
  provider: string;
  provider_ref: string | null;
  qr_text: string | null;
  qr_image: string | null;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
};

// what the browser is allowed to see of an order
export function publicOrder(o: OrderRow) {
  return {
    id: o.id,
    plan_id: o.plan_id,
    amount_bob: Number(o.amount_bob),
    days: o.days,
    status: o.status,
    qr_text: o.qr_text,
    qr_image: o.qr_image,
    expires_at: o.expires_at,
    paid_at: o.paid_at,
  };
}

export async function accessUntil(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.from("entitlements").select("access_until").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.access_until ?? null;
}

// ------------------------------------------------------------------ providers

export type ChargeStatus = "pending" | "paid" | "expired";

export interface Charge {
  providerRef: string;
  qrText: string | null;   // raw QR payload, rendered in the browser
  qrImage: string | null;  // or a ready image (data URL) when the provider sends one
}

export interface PaymentProvider {
  readonly name: string;
  readonly isTest: boolean;
  createCharge(input: { orderId: string; amountBob: number; description: string; expiresAt: Date }): Promise<Charge>;
  getStatus(providerRef: string): Promise<ChargeStatus>;
  // Finds the charge reference in a webhook. Authenticity comes from
  // getStatus afterwards, never from the webhook body.
  referenceFromWebhook(body: unknown): string | null;
}

// Stands in for a real Bolivian QR provider. Its QR cannot be paid from a
// bank app; an academy admin marks it paid with the mock-pay function.
export class MockProvider implements PaymentProvider {
  readonly name = "mock";
  readonly isTest = true;

  constructor(private readonly admin: SupabaseClient) {}

  async createCharge(input: { orderId: string; amountBob: number }): Promise<Charge> {
    const providerRef = `mock_${input.orderId}`;
    const { error } = await this.admin
      .from("mock_charges")
      .insert({ provider_ref: providerRef, order_id: input.orderId, amount_bob: input.amountBob });
    if (error) throw error;
    return {
      providerRef,
      qrText: `BRAIN-ACADEMY-TEST|${providerRef}|BOB ${input.amountBob.toFixed(2)}`,
      qrImage: null,
    };
  }

  async getStatus(providerRef: string): Promise<ChargeStatus> {
    const { data, error } = await this.admin
      .from("mock_charges")
      .select("status")
      .eq("provider_ref", providerRef)
      .maybeSingle();
    if (error) throw error;
    return data?.status === "paid" ? "paid" : "pending";
  }

  referenceFromWebhook(body: unknown): string | null {
    const ref = (body as { provider_ref?: unknown } | null)?.provider_ref;
    return typeof ref === "string" && ref.length <= 200 ? ref : null;
  }
}

// To add a real provider (CUCU, a bank API...): implement PaymentProvider
// from its documentation, add a case below, set the PAYMENT_PROVIDER
// secret, and set payment_mode to 'live' in public.app_settings.
export function providerFor(admin: SupabaseClient, name?: string): PaymentProvider {
  const chosen = (name ?? Deno.env.get("PAYMENT_PROVIDER") ?? "mock").toLowerCase();
  switch (chosen) {
    case "mock":
      return new MockProvider(admin);
    default:
      throw new HttpError(503, "Payments are not available yet. Please try again soon.");
  }
}

export async function paymentMode(admin: SupabaseClient): Promise<"test" | "live"> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", "payment_mode").maybeSingle();
  if (error) throw error;
  return data?.value === "live" ? "live" : "test";
}

// In live mode the test provider is refused, so forgetting to configure a
// real provider can never hand out free access.
export async function assertProviderAllowed(admin: SupabaseClient, provider: PaymentProvider): Promise<void> {
  if (provider.isTest && (await paymentMode(admin)) === "live") {
    throw new HttpError(503, "Payments are not available yet. Please try again soon.");
  }
}

// Confirms with the provider and, if paid, fulfils the order exactly once.
export async function confirmAndFulfill(
  admin: SupabaseClient,
  provider: PaymentProvider,
  providerRef: string,
  source: string,
): Promise<{ status: string; order: OrderRow | null }> {
  const { data: order, error } = await admin
    .from("orders")
    .select("*")
    .eq("provider", provider.name)
    .eq("provider_ref", providerRef)
    .maybeSingle<OrderRow>();
  if (error) throw error;
  if (!order) return { status: "unknown", order: null };
  if (order.status === "paid") return { status: "paid", order };
  if (order.status === "cancelled") return { status: "cancelled", order };

  const remote = await provider.getStatus(providerRef);
  if (remote !== "paid") return { status: order.status, order };

  const { data: paid, error: rpcError } = await admin
    .rpc("fulfill_order", { p_order_id: order.id })
    .single<OrderRow>();
  if (rpcError) throw rpcError;

  const { error: eventError } = await admin.from("payment_events").insert({
    provider: provider.name,
    provider_ref: providerRef,
    order_id: order.id,
    kind: `fulfilled:${source}`,
  });
  if (eventError) console.error("could not record payment event", eventError);

  return { status: "paid", order: paid };
}
