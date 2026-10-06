import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Razorpay REST client (no SDK): create an order, read a payment, capture an
 * authorized payment, and verify the two signatures Razorpay issues. Only the server holds
 * the key secret. See https://razorpay.com/docs/payments/server-integration/nodejs/
 */
export class RazorpayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RazorpayError";
  }
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

export interface RazorpayPayment {
  id: string;
  order_id?: string;
  status: string; // created | authorized | captured | refunded | failed
  amount: number;
  currency: string;
  method?: string;
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export class RazorpayClient {
  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret?: string,
    private readonly baseUrl = "https://api.razorpay.com/v1",
  ) {}

  /** Test-mode keys start with `rzp_test_`; shown honestly in the UI. */
  get isTestMode(): boolean {
    return this.keyId.startsWith("rzp_test_");
  }

  get hasWebhookSecret(): boolean {
    return !!this.webhookSecret;
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes?: Record<string, string> }): Promise<RazorpayOrder> {
    return this.request<RazorpayOrder>("POST", "/orders", {
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      notes: input.notes,
    });
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
  }

  async fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
    const res = await this.request<{ items?: RazorpayPayment[] }>("GET", `/orders/${encodeURIComponent(orderId)}/payments`);
    return res.items ?? [];
  }

  async capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, {
      amount: amountPaise,
      currency: "INR",
    });
  }

  /** Checkout success callback: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = createHmac("sha256", this.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    return safeEqualHex(expected, signature);
  }

  /** Webhook: HMAC_SHA256(raw request body, webhook_secret) in `X-Razorpay-Signature`. */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    if (!this.webhookSecret) return false;
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    return safeEqualHex(expected, signature);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          authorization: "Basic " + Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64"),
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        // Razorpay error bodies are `{ error: { description } }`; never echo the key or the body verbatim.
        let description = "";
        try {
          description = String((JSON.parse(text) as { error?: { description?: string } }).error?.description ?? "");
        } catch {
          // not JSON
        }
        throw new RazorpayError(`Razorpay ${method} ${path} failed (${res.status}) ${description}`.trim(), res.status);
      }
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof RazorpayError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new RazorpayError("Razorpay request timed out", 504);
      throw new RazorpayError("Razorpay request failed: " + (error instanceof Error ? error.message : String(error)), 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
