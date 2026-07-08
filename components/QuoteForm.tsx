"use client";

import { useMemo, useState } from "react";
import { calculateQuote, ServiceKey, type QuoteSizeKey } from "@/lib/pricing";

const serviceOptions: { label: string; value: ServiceKey; note?: string }[] = [
  { label: "Weekly Lawn Care", value: "weekly_lawn" },
  { label: "Biweekly Lawn Care", value: "biweekly_lawn" },
  { label: "One-Time Lawn Cut", value: "one_time_lawn" },
  { label: "Spring Cleanup", value: "spring_cleanup", note: "Seasonal extra charge" },
  { label: "Fall Cleanup", value: "fall_cleanup", note: "Seasonal extra charge" },
  { label: "Snow Removal", value: "snow_removal" },
  { label: "Extra Service Request", value: "extra_service", note: "Custom quote later" }
];

type SizeKey = QuoteSizeKey;

export default function QuoteForm() {
  const [step, setStep] = useState(1);
  const [service, setService] = useState<ServiceKey>("weekly_lawn");
  const [size, setSize] = useState<SizeKey>("medium");
  const [backyard, setBackyard] = useState(true);
  const [gated, setGated] = useState(false);
  const [annual, setAnnual] = useState(false);
  const [lead, setLead] = useState({ name: "", phone: "", email: "", address: "", notes: "" });

  const quote = useMemo(() => calculateQuote({ service, size, backyard, gated, annual }), [service, size, backyard, gated, annual]);
  const isExtra = service === "extra_service";

  function saveLead() {
    const savedLeads = JSON.parse(window.localStorage.getItem("damasio_leads") || "[]");
    savedLeads.unshift({
      id: window.crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...lead,
      service,
      status: isExtra ? "new" : "quoted",
      subtotal: isExtra ? 0 : quote.subtotal,
      tax: isExtra ? 0 : quote.tax,
      total: isExtra ? 0 : quote.total
    });
    window.localStorage.setItem("damasio_leads", JSON.stringify(savedLeads));
    setStep(4);
  }

  return (
    <div className="card quote-card">
      <div className="quote-top">
        <div className="quote-title">Instant Quote</div>
        <div className="step-pill">Step {step}/4</div>
      </div>

      {step === 1 && (
        <div className="form-stack">
          <strong>What service do you need?</strong>
          <div className="option-grid">
            {serviceOptions.map((item) => (
              <button key={item.value} type="button" onClick={() => setService(item.value)} className={service === item.value ? "option active" : "option"}>
                <strong>{item.label}</strong>
                {item.note ? <span>{item.note}</span> : null}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setStep(2)} className="button button-primary">Next</button>
        </div>
      )}

      {step === 2 && (
        <div className="form-stack">
          <label>
            <span className="label">Property address</span>
            <input className="input" placeholder="123 Main St, Hamilton, ON" value={lead.address} onChange={(event) => setLead({ ...lead, address: event.target.value })} />
          </label>

          {!isExtra && (
            <>
              <label>
                <span className="label">Property size</span>
                <select className="select" value={size} onChange={(event) => setSize(event.target.value as SizeKey)}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                  <option value="xlarge">Extra Large</option>
                </select>
              </label>
              <div className="row">
                <button type="button" onClick={() => setBackyard(!backyard)} className="button button-secondary">Backyard: {backyard ? "Yes" : "No"}</button>
                <button type="button" onClick={() => setGated(!gated)} className="button button-secondary">Gate: {gated ? "Yes" : "No"}</button>
                <button type="button" onClick={() => setAnnual(!annual)} className="button button-secondary">Annual: {annual ? "Yes" : "No"}</button>
              </div>
            </>
          )}

          {isExtra && (
            <label>
              <span className="label">Describe what you need</span>
              <textarea className="textarea" placeholder="Example: remove old mulch and install black mulch in the front garden..." value={lead.notes} onChange={(event) => setLead({ ...lead, notes: event.target.value })} />
            </label>
          )}

          <div className="row">
            <button type="button" onClick={() => setStep(1)} className="button button-secondary">Back</button>
            <button type="button" onClick={() => setStep(3)} className="button button-primary">Next</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="form-stack">
          <strong>Almost done. Where should we send your quote?</strong>
          <input className="input" placeholder="Full name" value={lead.name} onChange={(event) => setLead({ ...lead, name: event.target.value })} />
          <input className="input" placeholder="Phone" value={lead.phone} onChange={(event) => setLead({ ...lead, phone: event.target.value })} />
          <input className="input" placeholder="Email" value={lead.email} onChange={(event) => setLead({ ...lead, email: event.target.value })} />
          <div className="row">
            <button type="button" onClick={() => setStep(2)} className="button button-secondary">Back</button>
            <button type="button" onClick={saveLead} className="button button-primary">Show Quote</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="form-stack">
          {isExtra ? (
            <div className="quote-result">
              <small>Extra service request</small>
              <div className="quote-price">Received</div>
              <p>We will review your request and send a custom quote shortly.</p>
            </div>
          ) : (
            <div className="quote-result">
              <small>Your estimated quote</small>
              <div className="quote-price">${quote.total.toFixed(2)}</div>
              <p>Subtotal ${quote.subtotal.toFixed(2)} + HST ${quote.tax.toFixed(2)}</p>
            </div>
          )}
          <div className="row">
            <button type="button" className="button button-primary">Credit / Debit</button>
            <button type="button" className="button button-secondary">e-Transfer</button>
            <button type="button" className="button button-secondary">Cash / Cheque</button>
          </div>
          <button type="button" onClick={() => setStep(1)} className="button button-secondary">Start another quote</button>
        </div>
      )}
    </div>
  );
}

