import { useState } from "react";
import { Loader2 } from "lucide-react";
import { OUTCOME_LABEL, finishCall, scheduleCallback } from "@/lib/call-hooks";

const soon = () => { const d = new Date(Date.now() + 86400000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); d.setHours(10, 0, 0, 0); return d.toISOString().slice(0, 16); };

/** Wrap-up for one finished call. Nothing about the conversation is filled in for the adviser: they say what happened. */
export function WrapUp({ callId, caseId, phone, onDone }: { callId: string; caseId: string | null; phone: string | null; onDone: () => void }) {
  const [outcome, setOutcome] = useState("spoke_to_client");
  const [summary, setSummary] = useState("");
  const [notice, setNotice] = useState<"yes" | "no" | "">("");
  const [vuln, setVuln] = useState(false);
  const [complaint, setComplaint] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [cb, setCb] = useState(false);
  const [cbAt, setCbAt] = useState(soon());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const spoke = outcome === "spoke_to_client";
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await finishCall(callId, { outcome, summary, noticeGiven: spoke ? (notice === "" ? null : notice === "yes") : null, vulnerability: vuln, possibleComplaint: complaint, followUp: followUp || null });
      if ((cb || outcome === "call_back_requested") && caseId && phone) await scheduleCallback(caseId, phone, new Date(cbAt).toISOString(), 3, summary.slice(0, 200), callId);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 text-sm">
      <div><label className="label">What happened</label><select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(OUTCOME_LABEL).filter(([k]) => k !== "pending").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div><label className="label">Summary of the call</label><textarea className="input min-h-[90px]" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed and agreed" /></div>
      {spoke && (
        <div><label className="label">Did you tell the client the call may be recorded?</label>
          <div className="flex gap-4"><label className="flex items-center gap-1.5"><input type="radio" checked={notice === "yes"} onChange={() => setNotice("yes")} /> Yes</label><label className="flex items-center gap-1.5"><input type="radio" checked={notice === "no"} onChange={() => setNotice("no")} /> No</label></div></div>
      )}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={vuln} onChange={(e) => setVuln(e.target.checked)} /> Vulnerability came up</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={complaint} onChange={(e) => setComplaint(e.target.checked)} /> Possible complaint</label>
      </div>
      <div className="flex flex-wrap items-center gap-2"><label className="label !mb-0">Follow up on</label><input type="date" className="input !w-auto !py-1" min={new Date().toISOString().slice(0, 10)} value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></div>
      {caseId && phone && (
        <div className="space-y-1.5"><label className="flex items-center gap-1.5"><input type="checkbox" checked={cb || outcome === "call_back_requested"} disabled={outcome === "call_back_requested"} onChange={(e) => setCb(e.target.checked)} /> Schedule a callback</label>
          {(cb || outcome === "call_back_requested") && <input type="datetime-local" className="input" value={cbAt} onChange={(e) => setCbAt(e.target.value)} />}</div>
      )}
      {err && <p className="text-rose-600">{err}</p>}
      <button disabled={busy} onClick={save} className="btn btn-primary w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save and finish"}</button>
    </div>
  );
}
