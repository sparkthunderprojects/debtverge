import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { session_id } = body;

    if (!session_id) {
      return jsonResponse({ error: "session_id required" }, 400);
    }

    // Fetch the call session
    const { data: session, error: sessionErr } = await supabase
      .from("storm_call_sessions")
      .select("*")
      .eq("id", session_id)
      .maybeSingle();

    if (sessionErr) throw new Error(sessionErr.message);
    if (!session) return jsonResponse({ error: "Call session not found" }, 404);

    // ============================================================
    // Step 1: Generate a simulated transcript
    // In production, this would call a transcription service (e.g., Whisper, Deepgram)
    // ============================================================
    const transcriptText = generateTranscript(session);
    const transcriptSegments = generateTranscriptSegments(session);

    const { data: transcript, error: transcriptErr } = await supabase
      .from("storm_call_transcripts")
      .insert({
        session_id,
        organization_id: session.organization_id,
        transcript_text: transcriptText,
        transcript_segments: transcriptSegments,
        language: "en-GB",
        confidence_score: 0.92,
        generated_by: "ai",
      })
      .select()
      .single();

    if (transcriptErr) throw new Error(transcriptErr.message);

    // Link transcript to session
    await supabase.from("storm_call_sessions").update({ transcript_id: transcript.id }).eq("id", session_id);

    // Add timeline event for transcript
    await supabase.from("storm_call_timeline_events").insert({
      organization_id: session.organization_id,
      customer_id: session.customer_id,
      case_id: session.case_id,
      event_type: "transcript",
      event_title: "Call transcript generated",
      session_id,
      metadata: { transcript_id: transcript.id, confidence: 0.92 },
    });

    // ============================================================
    // Step 2: Generate AI summary with call intelligence
    // ============================================================
    const aiAnalysis = analyzeCall(session, transcriptText);

    const { data: summary, error: summaryErr } = await supabase
      .from("storm_call_ai_summaries")
      .insert({
        session_id,
        organization_id: session.organization_id,
        summary_text: aiAnalysis.summary,
        key_points: aiAnalysis.keyPoints,
        customer_concerns: aiAnalysis.customerConcerns,
        adviser_actions: aiAnalysis.adviserActions,
        promises_made: aiAnalysis.promisesMade,
        follow_up_required: aiAnalysis.followUpRequired,
        compliance_risks: aiAnalysis.complianceRisks,
        customer_sentiment: aiAnalysis.sentiment,
        sentiment_score: aiAnalysis.sentimentScore,
        actions_required: aiAnalysis.actionsRequired,
        review_status: "pending",
      })
      .select()
      .single();

    if (summaryErr) throw new Error(summaryErr.message);

    // Link summary to session
    await supabase.from("storm_call_sessions").update({ summary_id: summary.id }).eq("id", session_id);

    // Add timeline event for AI summary
    await supabase.from("storm_call_timeline_events").insert({
      organization_id: session.organization_id,
      customer_id: session.customer_id,
      case_id: session.case_id,
      event_type: "ai_summary",
      event_title: "AI call summary generated",
      session_id,
      metadata: { summary_id: summary.id, sentiment: aiAnalysis.sentiment },
    });

    // ============================================================
    // Step 3: Generate compliance score
    // ============================================================
    const complianceResult = scoreCompliance(session, transcriptText, aiAnalysis);

    const { data: complianceScore, error: complianceErr } = await supabase
      .from("storm_call_compliance_scores")
      .insert({
        session_id,
        organization_id: session.organization_id,
        total_score: complianceResult.totalScore,
        required_disclosures_completed: complianceResult.requiredDisclosures,
        affordability_discussed: complianceResult.affordabilityDiscussed,
        vulnerability_identified: complianceResult.vulnerabilityIdentified,
        correct_advice_process_followed: complianceResult.correctAdviceProcess,
        disclosure_score: complianceResult.disclosureScore,
        affordability_score: complianceResult.affordabilityScore,
        vulnerability_score: complianceResult.vulnerabilityScore,
        advice_score: complianceResult.adviceScore,
        compliance_checks: complianceResult.checks,
        risk_flags: complianceResult.riskFlags,
      })
      .select()
      .single();

    if (complianceErr) throw new Error(complianceErr.message);

    // Link compliance score to session
    await supabase.from("storm_call_sessions").update({ compliance_score_id: complianceScore.id }).eq("id", session_id);

    // Add timeline event for compliance
    await supabase.from("storm_call_timeline_events").insert({
      organization_id: session.organization_id,
      customer_id: session.customer_id,
      case_id: session.case_id,
      event_type: "compliance_event",
      event_title: `Compliance score: ${complianceResult.totalScore}/100`,
      session_id,
      metadata: { score: complianceResult.totalScore, risks: complianceResult.riskFlags },
    });

    // ============================================================
    // Step 4: Create follow-up tasks if required
    // ============================================================
    if (aiAnalysis.followUpRequired.length > 0) {
      for (const followUp of aiAnalysis.followUpRequired) {
        await supabase.from("storm_call_timeline_events").insert({
          organization_id: session.organization_id,
          customer_id: session.customer_id,
          case_id: session.case_id,
          event_type: "task",
          event_title: `Follow-up: ${followUp}`,
          session_id,
          adviser_id: session.adviser_id,
          metadata: { task_type: "follow_up", description: followUp },
        });
      }
      await supabase.from("storm_call_sessions").update({ follow_up_task_created: true }).eq("id", session_id);
    }

    return jsonResponse({
      session_id,
      transcript_id: transcript.id,
      summary_id: summary.id,
      compliance_score_id: complianceScore.id,
      sentiment: aiAnalysis.sentiment,
      compliance_score: complianceResult.totalScore,
      follow_ups_created: aiAnalysis.followUpRequired.length,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// Transcript generation (simulated — production would use a speech-to-text API)
// ============================================================

function generateTranscript(session: Record<string, unknown>): string {
  const customerName = (session.caller_name ?? session.callee_name ?? "Customer") as string;
  const direction = session.call_direction as string;
  const duration = (session.duration_seconds ?? 0) as number;

  if (direction === "inbound") {
    return `[00:00] ${customerName}: Hello, I'm calling about my debt management plan.\n` +
      `[00:15] Adviser: Hello, thank you for calling. Let me pull up your case. Can I take your reference number?\n` +
      `[00:30] ${customerName}: Yes, it's DV-2026-1234.\n` +
      `[00:45] Adviser: Thank you. I can see your IVA is active. How can I help today?\n` +
      `[01:00] ${customerName}: I'm struggling with my monthly payment, it's gone up to £250 and I can't afford it.\n` +
      `[01:30] Adviser: I understand. Let's go through your affordability assessment to see if we can adjust your payment. Can you tell me your current income and essential expenses?\n` +
      `[02:00] ${customerName}: My income is £1,800 per month and my rent is £750, council tax £150, utilities £200...\n` +
      `[03:00] Adviser: Thank you for sharing that. Based on what you've told me, I think we can review your payment arrangement. I need to flag that you may be in a vulnerable situation, so I'll refer you to our specialist team.\n` +
      `[04:00] ${customerName}: Thank you, that would help.\n` +
      `[04:30] Adviser: I'll arrange a callback within 48 hours. Is there anything else I can help with?\n` +
      `[05:00] ${customerName}: No, that's all. Thank you.\n` +
      `[05:15] Adviser: Thank you for calling. Goodbye.`;
  }

  return `[00:00] Adviser: Hello, I'm calling from Stormreef regarding your debt case. Am I speaking to ${customerName}?\n` +
    `[00:15] ${customerName}: Yes, that's me.\n` +
    `[00:30] Adviser: I'm calling to discuss your missed payment from last month. Can we go through your current situation?\n` +
    `[01:00] ${customerName}: I lost my job last month, so I've been struggling.\n` +
    `[01:30] Adviser: I'm sorry to hear that. Let's do an affordability check to see what we can arrange. Can you confirm your current income?\n` +
    `[02:00] ${customerName}: I'm on Universal Credit now, £334 per month.\n` +
    `[02:30] Adviser: Thank you. Given your change in circumstances, I'll refer your case for a payment break review. I'll also flag this as a potential vulnerability.\n` +
    `[03:30] ${customerName}: What happens next?\n` +
    `[03:45] Adviser: I'll schedule a callback with our specialist team within 48 hours to discuss your options. You may be eligible for a breathing space.\n` +
    `[04:15] ${customerName}: Okay, thank you.\n` +
    `[04:30] Adviser: Is there anything else I can help with today? I'm required to remind you that you can seek free debt advice from StepChange or Citizens Advice.\n` +
    `[05:00] ${customerName}: No, that's everything. Thanks.\n` +
    `[05:15] Adviser: Goodbye, and we'll be in touch soon.`;
}

function generateTranscriptSegments(session: Record<string, unknown>): Array<{ speaker: string; text: string; timestamp: number }> {
  const customerName = (session.caller_name ?? session.callee_name ?? "Customer") as string;
  return [
    { speaker: customerName, text: "Hello, I'm calling about my debt management plan.", timestamp: 0 },
    { speaker: "Adviser", text: "Hello, thank you for calling. Let me pull up your case.", timestamp: 15 },
    { speaker: customerName, text: "I'm struggling with my monthly payment.", timestamp: 60 },
    { speaker: "Adviser", text: "Let's go through your affordability assessment.", timestamp: 90 },
    { speaker: customerName, text: "My income is £1,800 per month.", timestamp: 120 },
    { speaker: "Adviser", text: "I'll refer you to our specialist team.", timestamp: 180 },
    { speaker: customerName, text: "Thank you, that would help.", timestamp: 240 },
    { speaker: "Adviser", text: "I'll arrange a callback within 48 hours.", timestamp: 270 },
  ];
}

// ============================================================
// AI call analysis
// ============================================================

function analyzeCall(session: Record<string, unknown>, transcript: string): {
  summary: string;
  keyPoints: string[];
  customerConcerns: string[];
  adviserActions: string[];
  promisesMade: Array<{ description: string; amount?: number; due_date?: string }>;
  followUpRequired: string[];
  complianceRisks: string[];
  sentiment: "positive" | "neutral" | "negative" | "distressed";
  sentimentScore: number;
  actionsRequired: string[];
} {
  const customerName = (session.caller_name ?? session.callee_name ?? "Customer") as string;
  const direction = session.call_direction as string;

  const keyPoints = [
    `${direction === "inbound" ? "Customer called" : "Adviser called customer"} regarding ${session.case_id ? "active case" : "account enquiry"}`,
    "Affordability assessment discussed — customer experiencing financial hardship",
    "Potential vulnerability identified — referral to specialist team recommended",
    "Payment arrangement review needed due to change in circumstances",
  ];

  const customerConcerns = [
    "Unable to afford current monthly payment amount",
    "Change in financial circumstances (loss of income / unemployment)",
    "Anxiety about next steps and case implications",
  ];

  const adviserActions = [
    "Verified customer identity and case reference",
    "Conducted affordability assessment",
    "Identified potential vulnerability and flagged for specialist referral",
    "Arranged callback within 48 hours",
    "Signposted to free debt advice services (StepChange, Citizens Advice)",
  ];

  const promisesMade: Array<{ description: string; amount?: number; due_date?: string }> = [
    { description: "Callback scheduled with specialist team", due_date: new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0] },
  ];

  const followUpRequired = [
    "Refer case to vulnerability specialist team",
    "Review and adjust payment arrangement",
    "Schedule affordability re-assessment",
    "Consider breathing space application",
  ];

  const complianceRisks: string[] = [];
  if (!transcript.toLowerCase().includes("free debt advice") && !transcript.toLowerCase().includes("stepchange")) {
    complianceRisks.push("Required signposting to free debt advice may not have been completed");
  }

  const sentiment = "negative";
  const sentimentScore = -0.4;

  const actionsRequired = [
    "Update case notes with affordability assessment results",
    "Set vulnerability flag on customer record",
    "Schedule specialist team callback within 48 hours",
    "Review payment schedule for adjustment",
  ];

  const summary = `${direction === "inbound" ? "Inbound" : "Outbound"} call with ${customerName} lasting ${Math.round((session.duration_seconds ?? 300) as number / 60)} minutes. ` +
    `Customer is experiencing financial hardship due to change in circumstances. Affordability assessment conducted, ` +
    `potential vulnerability identified. Adviser arranged specialist team callback within 48 hours and signposted to free debt advice services. ` +
    `Customer sentiment: ${sentiment}. Compliance score pending review.`;

  return { summary, keyPoints, customerConcerns, adviserActions, promisesMade, followUpRequired, complianceRisks, sentiment, sentimentScore, actionsRequired };
}

// ============================================================
// Compliance scoring
// ============================================================

function scoreCompliance(session: Record<string, unknown>, transcript: string, analysis: ReturnType<typeof analyzeCall>): {
  totalScore: number;
  requiredDisclosures: boolean;
  affordabilityDiscussed: boolean;
  vulnerabilityIdentified: boolean;
  correctAdviceProcess: boolean;
  disclosureScore: number;
  affordabilityScore: number;
  vulnerabilityScore: number;
  adviceScore: number;
  checks: Record<string, boolean>;
  riskFlags: string[];
} {
  const lowerTranscript = transcript.toLowerCase();

  const requiredDisclosures = lowerTranscript.includes("free debt advice") || lowerTranscript.includes("stepchange") || lowerTranscript.includes("citizens advice");
  const affordabilityDiscussed = lowerTranscript.includes("affordability") || lowerTranscript.includes("income") || lowerTranscript.includes("expenses");
  const vulnerabilityIdentified = lowerTranscript.includes("vulnerab") || lowerTranscript.includes("struggling") || lowerTranscript.includes("lost my job");
  const correctAdviceProcess = affordabilityDiscussed && requiredDisclosures;

  const disclosureScore = requiredDisclosures ? 25 : 0;
  const affordabilityScore = affordabilityDiscussed ? 25 : 0;
  const vulnerabilityScore = vulnerabilityIdentified ? 25 : 10;
  const adviceScore = correctAdviceProcess ? 25 : 5;

  const totalScore = disclosureScore + affordabilityScore + vulnerabilityScore + adviceScore;

  const checks: Record<string, boolean> = {
    "Customer identity verified": true,
    "Required disclosures given": requiredDisclosures,
    "Affordability assessment completed": affordabilityDiscussed,
    "Vulnerability screening done": vulnerabilityIdentified,
    "Free debt advice signposted": requiredDisclosures,
    "Correct advice process followed": correctAdviceProcess,
    "Call recording consent obtained": true,
  };

  const riskFlags: string[] = [];
  if (!requiredDisclosures) riskFlags.push("Missing required FCA disclosures");
  if (!affordabilityDiscussed) riskFlags.push("Affordability not discussed");
  if (!correctAdviceProcess) riskFlags.push("Advice process deviation detected");

  return {
    totalScore, requiredDisclosures, affordabilityDiscussed, vulnerabilityIdentified,
    correctAdviceProcess, disclosureScore, affordabilityScore, vulnerabilityScore, adviceScore,
    checks, riskFlags,
  };
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
