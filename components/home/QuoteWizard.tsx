"use client";

import { createId } from "@/lib/id";
import { useMemo, useState } from "react";
import {
  calculateQuote,
  serviceLabels,
  ServiceKey,
  type CleanupDebrisLevelKey,
  type CleanupDisposalKey,
  type CleanupLeafLevelKey,
  type CleanupVisitCountKey,
  type DifficultyKey,
  type GrassHandlingKey,
  type SnowAreaKey,
  type SnowBillingKey,
  type SnowDrivewaySizeKey,
  type SnowSaltKey,
  type SnowSidewalkKey,
} from "@/lib/pricing";
import { saveLead, saveEstimate, LawnSize, GrassHeight } from "@/lib/storage";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";

const services: { key: ServiceKey; note?: string; price?: string }[] = [
  { key: "weekly_lawn", note: "Recurring route" },
  { key: "biweekly_lawn", note: "Every two weeks" },
  { key: "one_time_lawn", note: "One visit" },
  { key: "spring_cleanup", note: "Seasonal estimate" },
  { key: "fall_cleanup", note: "Seasonal estimate" },
  { key: "snow_removal", note: "Winter estimate" },
  { key: "extra_service", note: "Custom request" },
  { key: "year_care", note: "Premium annual care", price: "From $249/month" },
];

const lawnServices: ServiceKey[] = ["weekly_lawn", "biweekly_lawn", "one_time_lawn"];

const labels: Record<string, string> = {
  xs: "XS", small: "Small", medium: "Medium", large: "Large", oversize: "Oversize",
  "2in": "2 inches", "3in": "3 inches", "4in": "4 inches", "5in": "5 inches",
  mulched: "Mulched", bag_green_bin: "Bag to green bin", bag_leave_property: "Bag and leave on property", removed: "Removed",
  light: "Light", moderate: "Moderate", heavy: "Heavy", not_sure: "Not sure", typical: "Typical", wooded: "Large / wooded",
  haul_away: "Haul away debris", mulch_wooded_area: "Mulch or blow into wooded area", quote_both: "Quote both",
  one: "One visit", two: "Two visits", unlimited: "Unlimited visits", one_car: "1-car driveway", two_car: "2-car driveway",
  three_car: "3-car driveway", four_plus: "4+ car driveway", custom: "Custom / long driveway", under_500: "Under 500 sq ft",
  "500_1000": "500-1,000 sq ft", "1000_1500": "1,000-1,500 sq ft", "1500_plus": "1,500+ sq ft", no: "No", yes: "Yes",
  front_walk: "Front walkway", sidewalk_steps: "Sidewalk and steps", all_paved: "All paved surfaces", per_storm: "Per storm", seasonal: "Seasonal", both: "Quote both",
};

function pretty(value?: string) {
  return value ? labels[value] || value.replaceAll("_", " ") : "";
}

export function QuoteWizard() {
  const [step, setStep] = useState(1);
  const [service, setService] = useState<ServiceKey>("weekly_lawn");
  const [size, setSize] = useState<LawnSize | "">("");
  const [grassHandling, setGrassHandling] = useState<GrassHandlingKey | "">("");
  const [grassHeight, setGrassHeight] = useState<GrassHeight | "">("");
  const [difficulty, setDifficulty] = useState<DifficultyKey | "">("");
  const [cleanupLeafLevel, setCleanupLeafLevel] = useState<CleanupLeafLevelKey | "">("");
  const [cleanupDebrisLevel, setCleanupDebrisLevel] = useState<CleanupDebrisLevelKey | "">("");
  const [cleanupDisposal, setCleanupDisposal] = useState<CleanupDisposalKey | "">("");
  const [cleanupVisitCount, setCleanupVisitCount] = useState<CleanupVisitCountKey | "">("");
  const [snowDrivewaySize, setSnowDrivewaySize] = useState<SnowDrivewaySizeKey | "">("");
  const [snowArea, setSnowArea] = useState<SnowAreaKey | "">("");
  const [snowSidewalk, setSnowSidewalk] = useState<SnowSidewalkKey | "">("");
  const [snowSalt, setSnowSalt] = useState<SnowSaltKey | "">("");
  const [snowBilling, setSnowBilling] = useState<SnowBillingKey | "">("");
  const [quoteNumber, setQuoteNumber] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [lead, setLead] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [preQuoteAlerted, setPreQuoteAlerted] = useState(false);
  const [preQuoteId, setPreQuoteId] = useState("");

  const isCustom = service === "extra_service";
  const isYearCare = service === "year_care";
  const isManualQuote = isCustom || isYearCare;
  const isLawn = lawnServices.includes(service);
  const isCleanup = service === "spring_cleanup" || service === "fall_cleanup";
  const isSnow = service === "snow_removal";
  const hasLawnDetails = Boolean(size && grassHeight && grassHandling && difficulty);
  const hasCleanupDetails = Boolean(size && cleanupLeafLevel && cleanupDebrisLevel && cleanupDisposal && cleanupVisitCount && difficulty);
  const hasSnowDetails = Boolean(size && snowDrivewaySize && snowArea && snowSidewalk && snowSalt && snowBilling && difficulty);
  const hasYearCareDetails = Boolean(size && lead.notes.trim());
  const hasCustomDetails = Boolean(lead.notes.trim());
  const hasServiceDetails = isYearCare
    ? hasYearCareDetails
    : isCustom
      ? hasCustomDetails
      : (isLawn && hasLawnDetails) || (isCleanup && hasCleanupDetails) || (isSnow && hasSnowDetails);

  const missingDetailsMessage = isYearCare
    ? "Choose the property size and tell us what you would like included in Year Care."
    : isCustom
      ? "Tell us what you need before continuing."
      : isLawn
        ? "Choose lawn size, grass height, grass handling and terrain difficulty."
        : isCleanup
          ? "Choose property size, leaf amount, debris level, disposal, visit count and terrain difficulty."
          : isSnow
            ? "Choose property size, driveway size, snow area, sidewalk clearing, salting, billing and difficulty."
            : "Complete the service details before continuing.";

  const quote = useMemo(() => {
    if (!hasServiceDetails || isManualQuote) return { subtotal: 0, tax: 0, total: 0 };
    return calculateQuote({
      service,
      size: size as LawnSize,
      grassHeight: grassHeight || undefined,
      grassHandling: grassHandling || undefined,
      difficulty: difficulty || undefined,
      cleanupLeafLevel: cleanupLeafLevel || undefined,
      cleanupDebrisLevel: cleanupDebrisLevel || undefined,
      cleanupDisposal: cleanupDisposal || undefined,
      cleanupVisitCount: cleanupVisitCount || undefined,
      snowDrivewaySize: snowDrivewaySize || undefined,
      snowArea: snowArea || undefined,
      snowSidewalk: snowSidewalk || undefined,
      snowSalt: snowSalt || undefined,
      snowBilling: snowBilling || undefined,
    });
  }, [service, size, grassHeight, grassHandling, difficulty, cleanupLeafLevel, cleanupDebrisLevel, cleanupDisposal, cleanupVisitCount, snowDrivewaySize, snowArea, snowSidewalk, snowSalt, snowBilling, hasServiceDetails, isManualQuote]);

  const detailsSummaryItems = [
    size ? { label: "Property size", value: pretty(size) } : null,
    isLawn && grassHeight ? { label: "Grass height", value: pretty(grassHeight) } : null,
    isLawn && grassHandling ? { label: "Grass handling", value: pretty(grassHandling) } : null,
    isCleanup && cleanupLeafLevel ? { label: "Leaf amount", value: pretty(cleanupLeafLevel) } : null,
    isCleanup && cleanupDebrisLevel ? { label: "Stick/debris pickup", value: pretty(cleanupDebrisLevel) } : null,
    isCleanup && cleanupDisposal ? { label: "Cleanup disposal", value: pretty(cleanupDisposal) } : null,
    isCleanup && cleanupVisitCount ? { label: "Cleanup visits", value: pretty(cleanupVisitCount) } : null,
    isSnow && snowDrivewaySize ? { label: "Driveway size", value: pretty(snowDrivewaySize) } : null,
    isSnow && snowArea ? { label: "Snow clearing area", value: pretty(snowArea) } : null,
    isSnow && snowSidewalk ? { label: "Walkway clearing", value: pretty(snowSidewalk) } : null,
    isSnow && snowSalt ? { label: "Salt/de-icing", value: pretty(snowSalt) } : null,
    isSnow && snowBilling ? { label: "Snow billing", value: pretty(snowBilling) } : null,
    difficulty ? { label: "Access difficulty", value: pretty(difficulty) } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  const detailsSummary = detailsSummaryItems.map(item => `${item.label}: ${item.value}`).join(" | ");

  function showQuote() {
    if (!lead.address.trim()) return setMsg("Add the property address first.");
    if (!hasServiceDetails) return setMsg(missingDetailsMessage);
    if (!lead.name.trim() || !lead.phone.trim() || !lead.email.trim()) return setMsg("Add your name, phone and email before continuing.");
    setMsg("");
    setStep(4);
    if (!preQuoteAlerted) {
      setPreQuoteAlerted(true);
      void fetch("/api/public/quote-alert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
          service: serviceLabels[service],
          estimatedTotal: isManualQuote ? null : quote.total,
          notes: [lead.notes, detailsSummary].filter(Boolean).join(" | "),
          referralCode,
          website: "",
        }),
      }).then(async response => {
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.preQuoteId) setPreQuoteId(String(result.preQuoteId));
      }).catch(error => console.error("Pre-quote alert request failed", error));
    }
  }

  async function submit() {
    if (busy || quoteNumber) return;
    setBusy(true);
    setMsg("Sending your request...");
    try {
      const quoteNotes = [
        lead.notes,
        detailsSummary || null,
        isYearCare ? "Year Care starting point shown: $249/month. Final monthly price requires property and scope review." : null,
        !isManualQuote ? `Average estimate shown: $${quote.total.toFixed(2)}` : null,
      ].filter(Boolean).join(" | ");

      const propertyDetails = hasServiceDetails && !isCustom ? {
        serviceCategory: isLawn ? "lawn" as const : isCleanup ? "cleanup" as const : isSnow ? "snow" as const : undefined,
        lawnSize: size || undefined,
        grassHeight: isLawn ? grassHeight || undefined : undefined,
        grassHandling: isLawn ? grassHandling || undefined : undefined,
        difficulty: isLawn || isCleanup || isSnow ? difficulty || undefined : undefined,
        cleanupLeafLevel: isCleanup ? cleanupLeafLevel || undefined : undefined,
        cleanupDebrisLevel: isCleanup ? cleanupDebrisLevel || undefined : undefined,
        cleanupDisposal: isCleanup ? cleanupDisposal || undefined : undefined,
        cleanupVisitCount: isCleanup ? cleanupVisitCount || undefined : undefined,
        snowDrivewaySize: isSnow ? snowDrivewaySize || undefined : undefined,
        snowArea: isSnow ? snowArea || undefined : undefined,
        snowSidewalk: isSnow ? snowSidewalk || undefined : undefined,
        snowSalt: isSnow ? snowSalt || undefined : undefined,
        snowBilling: isSnow ? snowBilling || undefined : undefined,
        annual: isYearCare ? true : undefined,
      } : undefined;

      const response = await fetch("/api/public/quote-referral", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...lead,
          notes: quoteNotes,
          service: serviceLabels[service],
          referralCode,
          preQuoteId,
          estimatedTotal: isManualQuote ? null : quote.total,
          propertyDetails,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMsg(result.error || "Your quote request could not be sent.");
        return;
      }

      const id = createId();
      saveLead({
        id,
        createdAt: new Date().toISOString(),
        ...lead,
        service: serviceLabels[service],
        status: isManualQuote ? "new" : "quoted",
        subtotal: isManualQuote ? 0 : quote.subtotal,
        tax: isManualQuote ? 0 : quote.tax,
        total: isManualQuote ? 0 : quote.total,
        paymentStatus: "not_selected",
        notes: quoteNotes,
        photos: [],
        propertyDetails: {
          lawnSize: (size || "small") as LawnSize,
          grassHeight: (isLawn ? grassHeight || "3in" : "3in") as GrassHeight,
          grassHandling: isLawn ? (grassHandling || "mulched") as any : "no_preference",
          backyard: false,
          gated: false,
          adminNotes: detailsSummary,
          propertyAlerts: "",
          accessNotes: "",
        },
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
        items: [{ id: createId(), type: "service", description: serviceLabels[service], quantity: 1, unit: "service", unitPrice: isManualQuote ? 0 : quote.subtotal }],
      });
      setQuoteNumber(estimate.number);
      setMsg(result.companyName ? `Request sent directly to ${result.companyName}.` : "Request received. We will review the details and confirm the final quote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card quote-card">
      <div className="quote-head">
        <div><span className="quote-eyebrow">Property quote</span><h2>Instant Quote</h2></div>
        <span className="pill">Step {step} of 4</span>
      </div>
      <div className="progress" aria-label={`Quote progress: step ${step} of 4`}><div className="progress-bar" style={{ width: `${step * 25}%` }} /></div>

      {step === 1 && <div className="stack quote-step">
        <div className="quote-step-intro"><strong>What can we help with?</strong><span>Choose the closest match. You can add property details on the next step.</span></div>
        <div className="option-grid">{services.map(item => <button key={item.key} className={`${service === item.key ? "option active" : "option"} ${item.key === "year_care" ? "year-care-option" : ""}`} onClick={() => { setService(item.key); setPreQuoteAlerted(false); setPreQuoteId(""); setMsg(""); }}>
          <span className="option-copy"><strong>{serviceLabels[item.key]}</strong>{item.note && <small>{item.note}</small>}</span>
          {item.price && <span className="year-care-price">{item.price}</span>}
        </button>)}</div>
        {isYearCare && <div className="premium-service-note"><strong>Premium Year Care</strong><span>Starts at $249/month. Your final monthly price is confirmed after we review the property size and the services you want included.</span><small>* Premium service receives priority scheduling and route planning.</small></div>}
        {isCleanup && <div className="notice">Cleanup pricing is based on property size, leaf volume, debris, disposal and the number of visits.</div>}
        {isSnow && <div className="notice">Snow pricing is based on driveway size, clearing area, walkways, salting and billing preference.</div>}
        <button className="btn btn-primary quote-next" onClick={() => setStep(2)}>Continue</button>
      </div>}

      {step === 2 && <div className="stack quote-step">
        <div className="quote-step-intro"><strong>Tell us about the property</strong><span>These details help us price the work accurately.</span></div>
        <div className="field"><label>Property address</label><AddressAutocomplete value={lead.address} onChange={address => setLead({ ...lead, address })} placeholder="Street, city, postal code" ariaLabel="Property address" /></div>

        {isCustom ? <div className="field"><label>What do you need?</label><textarea className="input quote-notes" value={lead.notes} onChange={event => setLead({ ...lead, notes: event.target.value })} placeholder="Describe the work, timing and anything we should know about the property." /></div>
        : isYearCare ? <>
          <div className="field"><label>Property size</label><select className="input" required value={size} onChange={event => setSize(event.target.value as LawnSize | "")}><option value="">Choose size</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="oversize">Oversize</option></select></div>
          <div className="field"><label>What would you like included in Year Care?</label><textarea className="input quote-notes" value={lead.notes} onChange={event => setLead({ ...lead, notes: event.target.value })} placeholder="For example: weekly lawn care, spring and fall cleanup, garden maintenance, snow service, or other recurring work." /></div>
          <div className="premium-service-note compact"><strong>Starting at $249/month</strong><span>We use the property size and requested services to prepare the exact monthly price.</span><small>* Premium service receives priority scheduling and route planning.</small></div>
        </> : <>
          <div className="field"><label>{isSnow ? "Property / lot size" : isCleanup ? "Property cleanup size" : "Lawn size"}</label><select className="input" required value={size} onChange={event => setSize(event.target.value as LawnSize | "")}><option value="">Choose size</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="oversize">Oversize</option></select></div>

          {isLawn && <>
            <div className="field"><label>Grass height</label><select className="input" required value={grassHeight} onChange={event => setGrassHeight(event.target.value as GrassHeight | "")}><option value="">Choose height</option><option value="2in">2&quot;</option><option value="3in">3&quot;</option><option value="4in">4&quot;</option><option value="5in">5&quot;</option></select></div>
            <div className="field"><label>Grass handling</label><select className="input" required value={grassHandling} onChange={event => setGrassHandling(event.target.value as GrassHandlingKey | "")}><option value="">Choose handling</option><option value="mulched">Mulched</option><option value="bag_green_bin">Bag to green bin</option><option value="bag_leave_property">Bag and leave on property</option><option value="removed">Removed</option></select></div>
          </>}

          {isCleanup && <>
            <div className="field"><label>Leaf amount</label><select className="input" required value={cleanupLeafLevel} onChange={event => setCleanupLeafLevel(event.target.value as CleanupLeafLevelKey | "")}><option value="">Choose leaf amount</option><option value="light">Light - up to 10 bags</option><option value="moderate">Moderate - 11 to 25 bags</option><option value="heavy">Heavy - 26+ bags / many trees</option><option value="not_sure">Not sure</option></select></div>
            <div className="field"><label>Sticks and debris</label><select className="input" required value={cleanupDebrisLevel} onChange={event => setCleanupDebrisLevel(event.target.value as CleanupDebrisLevelKey | "")}><option value="">Choose debris level</option><option value="light">Light pickup</option><option value="typical">Typical branches/debris</option><option value="wooded">Large or wooded property</option></select></div>
            <div className="field"><label>Yard debris disposal</label><select className="input" required value={cleanupDisposal} onChange={event => setCleanupDisposal(event.target.value as CleanupDisposalKey | "")}><option value="">Choose disposal</option><option value="haul_away">Haul away debris</option><option value="bag_leave_property">Bag and leave on property</option><option value="mulch_wooded_area">Mulch / blow into wooded area</option><option value="quote_both">Quote both options</option></select></div>
            <div className="field"><label>Cleanup visits</label><select className="input" required value={cleanupVisitCount} onChange={event => setCleanupVisitCount(event.target.value as CleanupVisitCountKey | "")}><option value="">Choose visits</option><option value="one">One visit</option><option value="two">Two visits</option><option value="unlimited">Unlimited fall visits</option></select></div>
          </>}

          {isSnow && <>
            <div className="field"><label>Driveway size</label><select className="input" required value={snowDrivewaySize} onChange={event => setSnowDrivewaySize(event.target.value as SnowDrivewaySizeKey | "")}><option value="">Choose driveway</option><option value="one_car">1-car driveway</option><option value="two_car">2-car driveway</option><option value="three_car">3-car driveway</option><option value="four_plus">4+ car driveway</option><option value="custom">Long/custom driveway</option></select></div>
            <div className="field"><label>Snow clearing area</label><select className="input" required value={snowArea} onChange={event => setSnowArea(event.target.value as SnowAreaKey | "")}><option value="">Choose area</option><option value="under_500">Under 500 sq ft</option><option value="500_1000">500 - 1,000 sq ft</option><option value="1000_1500">1,000 - 1,500 sq ft</option><option value="1500_plus">1,500+ sq ft</option></select></div>
            <div className="field"><label>Sidewalk / walkway clearing</label><select className="input" required value={snowSidewalk} onChange={event => setSnowSidewalk(event.target.value as SnowSidewalkKey | "")}><option value="">Choose sidewalk scope</option><option value="no">No</option><option value="front_walk">Front walkway</option><option value="sidewalk_steps">Sidewalk and steps</option><option value="all_paved">All paved surfaces</option></select></div>
            <div className="field"><label>Salt / de-icing</label><select className="input" required value={snowSalt} onChange={event => setSnowSalt(event.target.value as SnowSaltKey | "")}><option value="">Choose salting</option><option value="no">No</option><option value="yes">Yes</option><option value="quote_both">Quote both</option></select></div>
            <div className="field"><label>Snow billing preference</label><select className="input" required value={snowBilling} onChange={event => setSnowBilling(event.target.value as SnowBillingKey | "")}><option value="">Choose billing</option><option value="per_storm">Per storm</option><option value="seasonal">Seasonal</option><option value="both">Quote both</option></select></div>
          </>}

          <div className="field"><label>Terrain / access difficulty</label><select className="input" required value={difficulty} onChange={event => setDifficulty(event.target.value as DifficultyKey | "")}><option value="">Choose one</option><option value="no">Standard access</option><option value="yes">Sloped, gated or difficult access</option></select></div>
        </>}

        {msg && <div className="payment-message">{msg}</div>}
        <div className="row quote-actions"><button className="btn btn-outline" onClick={() => setStep(1)}>Back</button><button className="btn btn-primary" onClick={() => { if (!lead.address.trim()) return setMsg("Add the property address first."); if (!hasServiceDetails) return setMsg(missingDetailsMessage); setMsg(""); setStep(3); }}>Continue</button></div>
      </div>}

      {step === 3 && <div className="stack quote-step">
        <div className="quote-step-intro"><strong>Where should we send the quote?</strong><span>We use these details only to follow up about this property request.</span></div>
        {isYearCare && <div className="notice">Year Care starts at $249/month. The final monthly price is confirmed after we review the property size and requested services.</div>}
        {!isManualQuote && <div className="notice">Your preliminary estimate appears on the next step. The final approved price is confirmed before service.</div>}
        <input className="input" placeholder="Full name" autoComplete="name" value={lead.name} onChange={event => setLead({ ...lead, name: event.target.value })} />
        <input className="input" placeholder="Phone" autoComplete="tel" value={lead.phone} onChange={event => setLead({ ...lead, phone: event.target.value })} />
        <input className="input" placeholder="Email" autoComplete="email" value={lead.email} onChange={event => setLead({ ...lead, email: event.target.value })} />
        <input className="input" placeholder="Company code (optional)" value={referralCode} maxLength={12} onChange={event => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        {msg && <div className="payment-message">{msg}</div>}
        <div className="row quote-actions"><button className="btn btn-outline" onClick={() => setStep(2)}>Back</button><button className="btn btn-primary" onClick={showQuote}>Review quote</button></div>
      </div>}

      {step === 4 && <div className="stack quote-step quote-step-review">
        <div className="quote-result">
          <small>{quoteNumber ? "Request received" : "Review before sending"}</small>
          <div className="quote-price">{quoteNumber || (isYearCare ? "From $249/month" : isCustom ? "Custom quote" : `$${quote.total.toFixed(2)}`)}</div>
          <p>{quoteNumber ? `We will review the request and send the final quote to ${lead.email}.` : isYearCare ? "Your exact monthly price is confirmed after the property size and requested services are reviewed." : isCustom ? "We will review the requested work and prepare a property-specific price." : "This is a preliminary estimate. Confirm below to send the request for final review."}</p>
        </div>
        {!isCustom && detailsSummaryItems.length > 0 && <div className="quote-scope-summary" aria-label="Selected property details">
          <div className="quote-scope-head"><span>Property details</span><strong>{isYearCare ? "Final price after review" : "Preliminary estimate"}</strong></div>
          <dl>{detailsSummaryItems.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          {isYearCare && <p>Year Care is a premium service with priority scheduling and route planning.</p>}
          {!isYearCare && <p>We review the property details before sending the final approved price.</p>}
        </div>}
        {quoteNumber ? <div className="notice">Quote reference: {quoteNumber}</div> : <div className="row quote-actions quote-actions-final"><button className="btn btn-outline" disabled={busy} onClick={() => { setPreQuoteAlerted(false); setStep(2); }}>Edit service</button><button className="btn btn-outline" disabled={busy} onClick={() => { setPreQuoteAlerted(false); setStep(3); }}>Edit contact</button><button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? "Sending..." : "Send quote request"}</button></div>}
        {msg && <div className="payment-message">{msg}</div>}
      </div>}
    </div>
  );
}
