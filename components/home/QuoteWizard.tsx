"use client";

import { createId } from "@/lib/id";
import { useMemo, useState } from "react";
import { calculateQuote, serviceLabels, ServiceKey, type DifficultyKey } from "@/lib/pricing";
import { saveLead, saveEstimate, GrassHandling, LawnSize, GrassHeight } from "@/lib/storage";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";

const services: { key: ServiceKey; note?: string }[] = [
  { key: "weekly_lawn" },
  { key: "biweekly_lawn" },
  { key: "one_time_lawn" },
  { key: "spring_cleanup", note: "Seasonal estimate" },
  { key: "fall_cleanup", note: "Seasonal estimate" },
  { key: "snow_removal" },
  { key: "extra_service", note: "Admin review" },
];

export function QuoteWizard() {
  const [step, setStep] = useState(1);
  const [service, setService] = useState<ServiceKey>("weekly_lawn");
  const [size, setSize] = useState<LawnSize | "">("");
  const [grassHandling, setGrassHandling] = useState<GrassHandling | "">("");
  const [grassHeight, setGrassHeight] = useState<GrassHeight | "">("");
  const [difficulty, setDifficulty] = useState<DifficultyKey | "">("");
  const [quoteNumber, setQuoteNumber] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [lead, setLead] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const isExtra = service === "extra_service";
  const isSeasonal = service === "spring_cleanup" || service === "fall_cleanup";
  const hasServiceDetails = Boolean(size && grassHeight && grassHandling && difficulty);
  const quote = useMemo(() => {
    if (!hasServiceDetails) return { subtotal: 0, tax: 0, total: 0 };
    return calculateQuote({
      service,
      size: size as LawnSize,
      grassHeight: grassHeight as GrassHeight,
      grassHandling: grassHandling as GrassHandling,
      difficulty: difficulty as DifficultyKey,
    });
  }, [service, size, grassHeight, grassHandling, difficulty, hasServiceDetails]);
  const detailsSummary = [
    size ? `Lawn size: ${size}` : null,
    grassHeight ? `Grass height: ${grassHeight}` : null,
    grassHandling ? `Grass handling: ${grassHandling.replaceAll("_", " ")}` : null,
    difficulty ? `Terrain difficulty: ${difficulty === "yes" ? "Yes" : "No"}` : null,
  ].filter(Boolean).join(" | ");

  function showQuote() {
    if (!lead.address.trim()) return setMsg("Add the property address first.");
    if (!isExtra && !hasServiceDetails) return setMsg("Choose lawn size, grass height, grass handling and terrain difficulty.");
    if (!lead.name.trim() || !lead.phone.trim() || !lead.email.trim()) return setMsg("Add name, phone and email before showing the quote.");
    setMsg("");
    setStep(4);
  }

  async function submit() {
    if (busy || quoteNumber) return;
    setBusy(true);
    setMsg("Sending your quote request to Admin...");
    try {
      const quoteNotes = [lead.notes, !isExtra ? detailsSummary : null, !isExtra ? `Average estimate shown: $${quote.total.toFixed(2)}` : null].filter(Boolean).join(" | ");
      const propertyDetails = hasServiceDetails ? { lawnSize: size, grassHeight, grassHandling, difficulty } : undefined;
      const response = await fetch("/api/public/quote-referral", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...lead, notes: quoteNotes, service: serviceLabels[service], referralCode, estimatedTotal: isExtra ? null : quote.total, propertyDetails }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMsg(result.error || "Quote request could not be sent.");
        return;
      }
      const id = createId();
      saveLead({
        id,
        createdAt: new Date().toISOString(),
        ...lead,
        service: serviceLabels[service],
        status: isExtra ? "new" : "quoted",
        subtotal: isExtra ? 0 : quote.subtotal,
        tax: isExtra ? 0 : quote.tax,
        total: isExtra ? 0 : quote.total,
        paymentStatus: "not_selected",
        notes: quoteNotes,
        photos: [],
        propertyDetails: { lawnSize: (size || "small") as LawnSize, grassHeight: (grassHeight || "3in") as GrassHeight, grassHandling: (grassHandling || "mulched") as GrassHandling, backyard: false, gated: false, adminNotes: "", propertyAlerts: "", accessNotes: "" },
      });
      const estimate = saveEstimate({
        validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        customer: lead.name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        title: serviceLabels[service],
        description: quoteNotes || `${serviceLabels[service]} requested from the public website.`,
        status: "draft",
        items: [{ id: createId(), type: "service", description: serviceLabels[service], quantity: 1, unit: "service", unitPrice: isExtra ? 0 : quote.subtotal }],
      });
      setQuoteNumber(estimate.number);
      setMsg(result.companyName ? `Request routed directly to ${result.companyName}.` : "Request sent to Admin for review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card quote-card">
      <div className="quote-head"><h2>Instant Quote</h2><span className="pill">Step {step}/4</span></div>
      <div className="progress"><div className="progress-bar" style={{ width: `${step * 25}%` }} /></div>

      {step === 1 && <div className="stack">
        <strong>What service do you need?</strong>
        <div className="option-grid">{services.map(item => <button key={item.key} className={service === item.key ? "option active" : "option"} onClick={() => setService(item.key)}><strong>{serviceLabels[item.key]}</strong>{item.note && <small>{item.note}</small>}</button>)}</div>
        {isSeasonal && <div className="notice">Admin confirms the exact service date after review.</div>}
        <button className="btn btn-primary" onClick={() => setStep(2)}>Next</button>
      </div>}

      {step === 2 && <div className="stack">
        <div className="field"><label>Property address</label><AddressAutocomplete value={lead.address} onChange={address => setLead({ ...lead, address })} placeholder="Street, city, postal code" ariaLabel="Property address" /></div>
        {!isExtra ? <>
          <div className="field"><label>Lawn size</label><select className="input" required value={size} onChange={event => setSize(event.target.value as LawnSize | "")}><option value="">Choose size</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="oversize">Oversize</option></select></div>
          <div className="field"><label>Grass height</label><select className="input" required value={grassHeight} onChange={event => setGrassHeight(event.target.value as GrassHeight | "")}><option value="">Choose height</option><option value="2in">2&quot;</option><option value="3in">3&quot;</option><option value="4in">4&quot;</option><option value="5in">5&quot;</option></select></div>
          <div className="field"><label>Grass handling</label><select className="input" required value={grassHandling} onChange={event => setGrassHandling(event.target.value as GrassHandling | "")}><option value="">Choose handling</option><option value="mulched">Mulched</option><option value="bag_green_bin">Bag to green bin</option><option value="bag_leave_property">Bag and leave on property</option><option value="removed">Removed</option></select></div>
          <div className="field"><label>Terrain difficulty</label><select className="input" required value={difficulty} onChange={event => setDifficulty(event.target.value as DifficultyKey | "")}><option value="">Choose difficulty</option><option value="no">No</option><option value="yes">Yes</option></select></div>
        </> : <div className="field"><label>Tell us what you need</label><textarea className="input" style={{ minHeight: 120 }} value={lead.notes} onChange={event => setLead({ ...lead, notes: event.target.value })} /></div>}
        {msg && <div className="payment-message">{msg}</div>}
        <div className="row"><button className="btn btn-outline" onClick={() => setStep(1)}>Back</button><button className="btn btn-primary" onClick={() => { if (!lead.address.trim()) return setMsg("Add the property address first."); if (!isExtra && !hasServiceDetails) return setMsg("Choose lawn size, grass height, grass handling and terrain difficulty."); setMsg(""); setStep(3); }}>Next</button></div>
      </div>}

      {step === 3 && <div className="stack">
        <strong>Where should we send your final quote?</strong>
        <div className="notice">Your average estimate appears after these details are complete. Nothing is saved or sent yet.</div>
        <input className="input" placeholder="Full name" value={lead.name} onChange={event => setLead({ ...lead, name: event.target.value })} />
        <input className="input" placeholder="Phone" value={lead.phone} onChange={event => setLead({ ...lead, phone: event.target.value })} />
        <input className="input" placeholder="Email" value={lead.email} onChange={event => setLead({ ...lead, email: event.target.value })} />
        <input className="input" placeholder="Company code (optional)" value={referralCode} maxLength={12} onChange={event => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        {msg && <div className="payment-message">{msg}</div>}
        <div className="row"><button className="btn btn-outline" onClick={() => setStep(2)}>Back</button><button className="btn btn-primary" onClick={showQuote}>Show Quote</button></div>
      </div>}

      {step === 4 && <div className="stack">
        <div className="quote-result"><small>{quoteNumber ? "Request received" : "Review before sending"}</small><div className="quote-price">{quoteNumber || (isExtra ? "Admin Review" : `$${quote.total.toFixed(2)}`)}</div><p>{quoteNumber ? `Admin will review and send the final quote to ${lead.email}.` : "Confirm below to send this request to Admin for approval."}</p></div>
        {!isExtra && <div className="notice">{detailsSummary}. This is an average estimate, not the final approved price.</div>}
        {quoteNumber ? <div className="notice">Keep this quote number: {quoteNumber}</div> : <div className="row"><button className="btn btn-outline" disabled={busy} onClick={() => setStep(2)}>Edit Service</button><button className="btn btn-outline" disabled={busy} onClick={() => setStep(3)}>Edit Contact</button><button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? "Sending..." : "Send to Admin for Approval"}</button></div>}
        {msg && <div className="payment-message">{msg}</div>}
      </div>}
    </div>
  );
}
