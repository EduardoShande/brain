// POST from the payment provider when a QR is paid.
//
// Public on purpose: providers cannot sign in. That is safe because the body
// is only used to find the charge; access is granted only after asking the
// provider itself whether that charge was paid.
//
// Point the provider at: https://<project>.supabase.co/functions/v1/payment-webhook?provider=<name>

import { adminClient, confirmAndFulfill, errorResponse, json, providerFor } from "../_shared/payments.ts";

const MAX_BODY = 64_000;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const raw = (await req.text()).slice(0, MAX_BODY);
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      // not JSON; kept as raw text in the audit log
    }

    const admin = adminClient();
    const provider = providerFor(admin, new URL(req.url).searchParams.get("provider") ?? undefined);
    const ref = provider.referenceFromWebhook(body);

    const { error: logError } = await admin.from("payment_events").insert({
      provider: provider.name,
      provider_ref: ref,
      kind: "webhook",
      payload: body && typeof body === "object" ? body : { raw: raw.slice(0, 2000) },
    });
    if (logError) console.error("could not record webhook", logError);

    if (!ref) return json({ received: true, matched: false });
    const result = await confirmAndFulfill(admin, provider, ref, "webhook");
    return json({ received: true, status: result.status });
  } catch (e) {
    return errorResponse(e);
  }
});
