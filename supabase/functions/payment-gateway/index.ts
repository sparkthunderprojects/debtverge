import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GatewayRequest {
  gateway_type: string;
  action: string;
  test_mode?: boolean;
  merchant_id?: string;
  [key: string]: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: GatewayRequest = await req.json();
    const { gateway_type, action } = body;

    if (!gateway_type || !action) {
      return new Response(
        JSON.stringify({ error: "Missing gateway_type or action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    switch (action) {
      case "tokenise":
        return handleTokenise(body);
      case "charge":
        return handleCharge(body);
      case "refund":
        return handleRefund(body);
      case "delete_token":
        return handleDeleteToken(body);
      case "verify":
        return handleVerify(body);
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// Tokenise — creates a gateway token from card details
// In production, this calls the gateway's tokenisation API.
// The raw card data never touches the database — only the token.
// ============================================================
function handleTokenise(body: GatewayRequest): Response {
  const { cardholderName, expiryMonth, expiryYear, billingPostcode } = body as GatewayRequest & {
    cardholderName?: string;
    cardNumber?: string;
    expiryMonth?: number;
    expiryYear?: number;
    cvc?: string;
    billingPostcode?: string;
  };

  if (!cardholderName || !expiryMonth || !expiryYear) {
    return jsonResponse({ error: "Missing required card fields" }, 400);
  }

  // In production, the actual API key is read from Supabase edge function secrets
  // (configured via the tenant's secret_ref). Here we generate a mock token
  // that represents the gateway-side tokenisation result.
  const token = `tok_${body.gateway_type}_${crypto.randomUUID().replace(/-/g, "")}`;
  const last4 = "4242"; // In production, extracted from the card number sent to the gateway
  const cardBrand = body.gateway_type === "stripe" ? "visa" : "mc";

  return jsonResponse({
    gatewayToken: token,
    cardBrand,
    last4,
    expiryMonth,
    expiryYear,
  });
}

// ============================================================
// Charge — processes a payment using a saved token
// ============================================================
function handleCharge(body: GatewayRequest): Response {
  const { gatewayToken, amount, currency, description, metadata } = body as GatewayRequest & {
    gatewayToken?: string;
    amount?: number;
    currency?: string;
    description?: string;
    metadata?: Record<string, string>;
  };

  if (!gatewayToken || amount === undefined) {
    return jsonResponse({ error: "Missing gatewayToken or amount" }, 400);
  }

  // In production, this calls the gateway's charge/payment API using the
  // tenant's secret key (read from edge function secrets by secret_ref).
  const txnId = `pi_${body.gateway_type}_${crypto.randomUUID().replace(/-/g, "")}`;
  const isTestMode = body.test_mode ?? false;

  // Simulate payment processing (in production, real gateway response)
  const succeeded = isTestMode ? true : Math.random() > 0.05;

  return jsonResponse({
    gatewayTransactionId: txnId,
    status: succeeded ? "succeeded" : "failed",
    failureReason: succeeded ? undefined : "Card declined (insufficient funds)",
    rawResponse: {
      id: txnId,
      amount: Math.round(amount * 100),
      currency: currency || "GBP",
      status: succeeded ? "succeeded" : "declined",
      description: description || "",
      metadata: metadata || {},
      test_mode: isTestMode,
    },
  });
}

// ============================================================
// Refund — processes a full or partial refund
// ============================================================
function handleRefund(body: GatewayRequest): Response {
  const { gatewayTransactionId, amount } = body as GatewayRequest & {
    gatewayTransactionId?: string;
    amount?: number;
  };

  if (!gatewayTransactionId) {
    return jsonResponse({ error: "Missing gatewayTransactionId" }, 400);
  }

  const refundId = `re_${body.gateway_type}_${crypto.randomUUID().replace(/-/g, "")}`;
  const isPartial = amount !== undefined;

  return jsonResponse({
    gatewayTransactionId: refundId,
    status: isPartial ? "partially_refunded" : "refunded",
    rawResponse: {
      id: refundId,
      original_transaction: gatewayTransactionId,
      amount: amount ? Math.round(amount * 100) : null,
      status: "succeeded",
    },
  });
}

// ============================================================
// Delete Token — removes a tokenised payment method from the gateway
// ============================================================
function handleDeleteToken(body: GatewayRequest): Response {
  const { gatewayToken } = body as GatewayRequest & { gatewayToken?: string };

  if (!gatewayToken) {
    return jsonResponse({ error: "Missing gatewayToken" }, 400);
  }

  return jsonResponse({ deleted: true });
}

// ============================================================
// Verify — checks that the gateway credentials are valid
// ============================================================
function handleVerify(body: GatewayRequest): Response {
  // In production, this calls the gateway's account/merchant validation endpoint
  return jsonResponse({
    connected: true,
    merchantId: body.merchant_id || "acct_verified",
    displayName: `${body.gateway_type} Connection`,
    message: "Gateway credentials verified successfully",
  });
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
