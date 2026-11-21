import type {
  GatewayType,
  GatewayPaymentType,
  GatewayTransactionStatus,
} from "./types";

// ============================================================
// Gateway Adapter Interface — White-Label Payment Processing
// ============================================================
// Strictly adapter-based: each gateway provider implements this interface.
// Tenant firms plug in their own credentials via edge function secrets.
// No raw card data (PAN/CVV) ever touches the database — only tokens.

export interface TokeniseCardParams {
  cardholderName: string;
  cardNumber: string; // sent to edge function, never stored
  expiryMonth: number;
  expiryYear: number;
  cvc: string; // sent to edge function, never stored
  billingPostcode?: string;
}

export interface TokeniseCardResult {
  gatewayToken: string;
  cardBrand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface ProcessPaymentParams {
  gatewayToken: string;
  amount: number; // in pounds (decimal)
  currency: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface ProcessPaymentResult {
  gatewayTransactionId: string;
  status: GatewayTransactionStatus;
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface RefundParams {
  gatewayTransactionId: string;
  amount?: number; // partial refund if provided
}

export interface RefundResult {
  gatewayTransactionId: string;
  status: GatewayTransactionStatus;
  rawResponse: Record<string, unknown>;
}

export interface DeleteTokenResult {
  deleted: boolean;
}

export interface VerifyConnectionResult {
  connected: boolean;
  merchantId?: string;
  displayName?: string;
  message?: string;
}

export interface PaymentGatewayAdapter {
  readonly gatewayType: GatewayType;
  readonly displayName: string;
  readonly supportedFeatures: string[];

  tokeniseCard(
    params: TokeniseCardParams,
    credentials: GatewayCredentials,
  ): Promise<TokeniseCardResult>;

  processPayment(
    params: ProcessPaymentParams,
    credentials: GatewayCredentials,
  ): Promise<ProcessPaymentResult>;

  refund(
    params: RefundParams,
    credentials: GatewayCredentials,
  ): Promise<RefundResult>;

  deleteToken(
    gatewayToken: string,
    credentials: GatewayCredentials,
  ): Promise<DeleteTokenResult>;

  verifyConnection(credentials: GatewayCredentials): Promise<VerifyConnectionResult>;
}

export interface GatewayCredentials {
  apiKey: string;
  merchantId?: string;
  webhookSecret?: string;
  testMode: boolean;
}

// ============================================================
// Adapter Registry — runtime gateway lookup by type
// ============================================================

const adapterRegistry = new Map<GatewayType, PaymentGatewayAdapter>();

export function registerGatewayAdapter(adapter: PaymentGatewayAdapter): void {
  adapterRegistry.set(adapter.gatewayType, adapter);
}

export function getGatewayAdapter(type: GatewayType): PaymentGatewayAdapter | undefined {
  return adapterRegistry.get(type);
}

export function getAvailableGatewayTypes(): GatewayType[] {
  return Array.from(adapterRegistry.keys());
}

// ============================================================
// Stripe Adapter (server-side calls via edge function)
// ============================================================

class StripeAdapter implements PaymentGatewayAdapter {
  readonly gatewayType: GatewayType = "stripe";
  readonly displayName = "Stripe";
  readonly supportedFeatures = ["recurring_card", "tokenisation", "refunds", "webhooks"];

  async tokeniseCard(
    _params: TokeniseCardParams,
    _credentials: GatewayCredentials,
  ): Promise<TokeniseCardResult> {
    // Card tokenisation is performed via the payment-gateway edge function
    // which calls Stripe.js / Stripe API server-side with the secret key.
    // The browser never sees the secret key or stores the PAN.
    return this.callEdgeFunction("tokenise", _params, _credentials);
  }

  async processPayment(
    params: ProcessPaymentParams,
    credentials: GatewayCredentials,
  ): Promise<ProcessPaymentResult> {
    return this.callEdgeFunction("charge", params, credentials);
  }

  async refund(
    params: RefundParams,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    return this.callEdgeFunction("refund", params, credentials);
  }

  async deleteToken(
    gatewayToken: string,
    credentials: GatewayCredentials,
  ): Promise<DeleteTokenResult> {
    return this.callEdgeFunction("delete_token", { gatewayToken }, credentials);
  }

  async verifyConnection(credentials: GatewayCredentials): Promise<VerifyConnectionResult> {
    return this.callEdgeFunction("verify", {}, credentials);
  }

  private async callEdgeFunction(
    action: string,
    payload: Record<string, unknown>,
    credentials: GatewayCredentials,
  ): Promise<any> {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-gateway`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    };
    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        gateway_type: this.gatewayType,
        action,
        test_mode: credentials.testMode,
        merchant_id: credentials.merchantId,
        ...payload,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `Gateway request failed (${response.status})`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ============================================================
// GoCardless Adapter (Direct Debit / BACS)
// ============================================================

class GoCardlessAdapter implements PaymentGatewayAdapter {
  readonly gatewayType: GatewayType = "gocardless";
  readonly displayName = "GoCardless";
  readonly supportedFeatures = ["recurring_bacs", "direct_debit", "tokenisation", "webhooks"];

  async tokeniseCard(
    _params: TokeniseCardParams,
    _credentials: GatewayCredentials,
  ): Promise<TokeniseCardResult> {
    throw new Error("GoCardless does not support card tokenisation. Use BACS direct debit mandate instead.");
  }

  async processPayment(
    params: ProcessPaymentParams,
    credentials: GatewayCredentials,
  ): Promise<ProcessPaymentResult> {
    return this.callEdgeFunction("charge", params, credentials);
  }

  async refund(
    params: RefundParams,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    return this.callEdgeFunction("refund", params, credentials);
  }

  async deleteToken(
    gatewayToken: string,
    credentials: GatewayCredentials,
  ): Promise<DeleteTokenResult> {
    return this.callEdgeFunction("delete_token", { gatewayToken }, credentials);
  }

  async verifyConnection(credentials: GatewayCredentials): Promise<VerifyConnectionResult> {
    return this.callEdgeFunction("verify", {}, credentials);
  }

  private async callEdgeFunction(
    action: string,
    payload: Record<string, unknown>,
    credentials: GatewayCredentials,
  ): Promise<any> {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-gateway`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        gateway_type: this.gatewayType,
        action,
        test_mode: credentials.testMode,
        merchant_id: credentials.merchantId,
        ...payload,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `Gateway request failed (${response.status})`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ============================================================
// Open Banking Adapter
// ============================================================

class OpenBankingAdapter implements PaymentGatewayAdapter {
  readonly gatewayType: GatewayType = "open_banking";
  readonly displayName = "Open Banking";
  readonly supportedFeatures = ["open_banking_payments", "recurring_variable", "tokenisation", "webhooks"];

  async tokeniseCard(
    _params: TokeniseCardParams,
    _credentials: GatewayCredentials,
  ): Promise<TokeniseCardResult> {
    throw new Error("Open Banking uses bank account mandates, not card tokenisation.");
  }

  async processPayment(
    params: ProcessPaymentParams,
    credentials: GatewayCredentials,
  ): Promise<ProcessPaymentResult> {
    return this.callEdgeFunction("charge", params, credentials);
  }

  async refund(
    params: RefundParams,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    return this.callEdgeFunction("refund", params, credentials);
  }

  async deleteToken(
    gatewayToken: string,
    credentials: GatewayCredentials,
  ): Promise<DeleteTokenResult> {
    return this.callEdgeFunction("delete_token", { gatewayToken }, credentials);
  }

  async verifyConnection(credentials: GatewayCredentials): Promise<VerifyConnectionResult> {
    return this.callEdgeFunction("verify", {}, credentials);
  }

  private async callEdgeFunction(
    action: string,
    payload: Record<string, unknown>,
    credentials: GatewayCredentials,
  ): Promise<any> {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-gateway`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        gateway_type: this.gatewayType,
        action,
        test_mode: credentials.testMode,
        merchant_id: credentials.merchantId,
        ...payload,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `Gateway request failed (${response.status})`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ============================================================
// Merchant Acquirer Adapter (generic)
// ============================================================

class MerchantAcquirerAdapter implements PaymentGatewayAdapter {
  readonly gatewayType: GatewayType = "merchant_acquirer";
  readonly displayName = "Merchant Acquirer";
  readonly supportedFeatures = ["recurring_card", "tokenisation"];

  async tokeniseCard(
    params: TokeniseCardParams,
    credentials: GatewayCredentials,
  ): Promise<TokeniseCardResult> {
    return this.callEdgeFunction("tokenise", params, credentials);
  }

  async processPayment(
    params: ProcessPaymentParams,
    credentials: GatewayCredentials,
  ): Promise<ProcessPaymentResult> {
    return this.callEdgeFunction("charge", params, credentials);
  }

  async refund(
    params: RefundParams,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    return this.callEdgeFunction("refund", params, credentials);
  }

  async deleteToken(
    gatewayToken: string,
    credentials: GatewayCredentials,
  ): Promise<DeleteTokenResult> {
    return this.callEdgeFunction("delete_token", { gatewayToken }, credentials);
  }

  async verifyConnection(credentials: GatewayCredentials): Promise<VerifyConnectionResult> {
    return this.callEdgeFunction("verify", {}, credentials);
  }

  private async callEdgeFunction(
    action: string,
    payload: Record<string, unknown>,
    credentials: GatewayCredentials,
  ): Promise<any> {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-gateway`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        gateway_type: this.gatewayType,
        action,
        test_mode: credentials.testMode,
        merchant_id: credentials.merchantId,
        ...payload,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `Gateway request failed (${response.status})`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ============================================================
// Custom Gateway Adapter (passthrough to edge function)
// ============================================================

class CustomAdapter implements PaymentGatewayAdapter {
  readonly gatewayType: GatewayType = "custom";
  readonly displayName = "Custom Gateway";
  readonly supportedFeatures = ["recurring_card", "tokenisation", "refunds"];

  async tokeniseCard(
    params: TokeniseCardParams,
    credentials: GatewayCredentials,
  ): Promise<TokeniseCardResult> {
    return this.callEdgeFunction("tokenise", params, credentials);
  }

  async processPayment(
    params: ProcessPaymentParams,
    credentials: GatewayCredentials,
  ): Promise<ProcessPaymentResult> {
    return this.callEdgeFunction("charge", params, credentials);
  }

  async refund(
    params: RefundParams,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    return this.callEdgeFunction("refund", params, credentials);
  }

  async deleteToken(
    gatewayToken: string,
    credentials: GatewayCredentials,
  ): Promise<DeleteTokenResult> {
    return this.callEdgeFunction("delete_token", { gatewayToken }, credentials);
  }

  async verifyConnection(credentials: GatewayCredentials): Promise<VerifyConnectionResult> {
    return this.callEdgeFunction("verify", {}, credentials);
  }

  private async callEdgeFunction(
    action: string,
    payload: Record<string, unknown>,
    credentials: GatewayCredentials,
  ): Promise<any> {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-gateway`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        gateway_type: this.gatewayType,
        action,
        test_mode: credentials.testMode,
        merchant_id: credentials.merchantId,
        ...payload,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `Gateway request failed (${response.status})`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ============================================================
// Register all adapters at module load
// ============================================================

registerGatewayAdapter(new StripeAdapter());
registerGatewayAdapter(new GoCardlessAdapter());
registerGatewayAdapter(new OpenBankingAdapter());
registerGatewayAdapter(new MerchantAcquirerAdapter());
registerGatewayAdapter(new CustomAdapter());

// ============================================================
// Waterfall Distribution Engine — computes allocation order
// ============================================================

export interface WaterfallAllocationInput {
  totalCollected: number;
  nomineeFeePercent?: number;
  supervisorFeePercent?: number;
  nomineeCosts: { payeeName: string; amount: number; reference?: string }[];
  thirdPartyDisbursements: { payeeName: string; amount: number; reference?: string }[];
  creditorClaims: { creditorId: string; creditorName: string; admittedDebt: number }[];
  reservePercent?: number;
}

export interface WaterfallAllocationOutput {
  entries: {
    category: string;
    payeeName: string;
    payeeReference: string | null;
    allocatedAmount: number;
    creditorId?: string;
  }[];
  totalAllocated: number;
  remainingReserve: number;
}

export function calculateWaterfallAllocation(input: WaterfallAllocationInput): WaterfallAllocationOutput {
  const entries: WaterfallAllocationOutput["entries"] = [];
  let remaining = input.totalCollected;
  const reservePct = input.reservePercent ?? 0;

  // Order 1: Nominee fee
  if (input.nomineeFeePercent && input.nomineeFeePercent > 0) {
    const fee = Math.round(remaining * (input.nomineeFeePercent / 100) * 100) / 100;
    if (fee > 0) {
      entries.push({
        category: "nominee_fee",
        payeeName: "Nominee Fee",
        payeeReference: null,
        allocatedAmount: fee,
      });
      remaining -= fee;
    }
  }

  // Order 2: Supervisor fee
  if (input.supervisorFeePercent && input.supervisorFeePercent > 0) {
    const fee = Math.round(remaining * (input.supervisorFeePercent / 100) * 100) / 100;
    if (fee > 0) {
      entries.push({
        category: "supervisor_fee",
        payeeName: "Supervisor Fee",
        payeeReference: null,
        allocatedAmount: fee,
      });
      remaining -= fee;
    }
  }

  // Order 3: Nominee costs (fixed amounts)
  for (const cost of input.nomineeCosts) {
    if (cost.amount > 0 && remaining >= cost.amount) {
      entries.push({
        category: "nominee_cost",
        payeeName: cost.payeeName,
        payeeReference: cost.reference ?? null,
        allocatedAmount: cost.amount,
      });
      remaining -= cost.amount;
    }
  }

  // Order 4: Third-party disbursements (fixed amounts)
  for (const disbursement of input.thirdPartyDisbursements) {
    if (disbursement.amount > 0 && remaining >= disbursement.amount) {
      entries.push({
        category: "third_party_disbursement",
        payeeName: disbursement.payeeName,
        payeeReference: disbursement.reference ?? null,
        allocatedAmount: disbursement.amount,
      });
      remaining -= disbursement.amount;
    }
  }

  // Order 5: Reserve
  if (reservePct > 0) {
    const reserve = Math.round(remaining * (reservePct / 100) * 100) / 100;
    if (reserve > 0) {
      entries.push({
        category: "reserve",
        payeeName: "Reserve Fund",
        payeeReference: null,
        allocatedAmount: reserve,
      });
      remaining -= reserve;
    }
  }

  // Order 6: Pro-rata creditor dividends
  const totalAdmitted = input.creditorClaims.reduce((s, c) => s + c.admittedDebt, 0);
  if (totalAdmitted > 0 && remaining > 0) {
    for (const creditor of input.creditorClaims) {
      const proRata = Math.round((creditor.admittedDebt / totalAdmitted) * remaining * 100) / 100;
      if (proRata > 0) {
        entries.push({
          category: "creditor_dividend",
          payeeName: creditor.creditorName,
          payeeReference: null,
          allocatedAmount: proRata,
          creditorId: creditor.creditorId,
        });
      }
    }
    remaining = 0;
  }

  const totalAllocated = entries.reduce((s, e) => s + e.allocatedAmount, 0);

  return {
    entries,
    totalAllocated,
    remainingReserve: Math.max(0, input.totalCollected - totalAllocated),
  };
}
