"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./snow.module.css";

type Plan = "single" | "monthly" | "season";
const plans: { key: Plan; title: string; description: string }[] = [
  { key: "single", title: "One-time visit", description: "Snow clearing when you need it. One confirmed service, one payment." },
  { key: "monthly", title: "Monthly coverage", description: "A monthly service arrangement with clear terms and coverage." },
  { key: "season", title: "Full winter season", description: "A winter-long agreement tailored to your property and service needs." },
];

export default function PrivateSnowPage() {
  const [plan, setPlan] = useState<Plan>("single");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("Hamilton");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch("/api/public/private-snow-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, phone, address, city, notes, plan, website: "" }),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Could not send your request.");
      setConfirmed(true);
      setMessage("Your request has been received. We'll confirm availability, scope and the exact price before sending a secure payment link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send your request.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.site}>
    <header className={styles.header}><Link href="/" className={styles.brand}><img src="/brand/4ever-seasons-logo-mark.jpg" alt="" width="46" height="46" /><span><strong>4EVER SEASONS</strong><small>Private property services</small></span></Link><nav><a href="#plans">Snow plans</a><a href="#request">Request service</a></nav></header>
    <main>
      <section className={styles.hero}><div className={styles.heroContent}>
        <span className={styles.eyebrow}>Hamilton & surrounding communities · Ontario</span>
        <h1>Snow removal, personally handled.</h1>
        <p>Reliable residential snow clearing with straightforward pricing, organized visits, and photo records of completed work.</p>
        <a className={styles.primary} href="#request">Request snow removal</a>
        <p className={styles.small}>Every request is reviewed before a service date or payment is confirmed.</p>
      </div></section>
      <section id="plans" className={styles.section}><span className={styles.eyebrow}>Choose what works for your home</span><h2>Simple snow service options</h2><div className={styles.plans}>
        {plans.map((item) => <button type="button" key={item.key} className={plan === item.key ? styles.selected : styles.plan} onClick={() => { setPlan(item.key); document.getElementById("request")?.scrollIntoView({ behavior: "smooth" }); }}>
          <strong>{item.title}</strong><span>{item.description}</span><small>{plan === item.key ? "Selected" : "Choose this option"}</small>
        </button>)}
      </div></section>
      <section id="request" className={styles.requestArea}><div className={styles.requestCopy}><span className={styles.eyebrow}>Direct service</span><h2>Tell us about your property.</h2><p>Your request goes straight to the owner. Once the job and price are confirmed, you can pay securely online.</p><div className={styles.steps}><p><strong>01</strong> Request a visit or plan</p><p><strong>02</strong> Receive your exact quote</p><p><strong>03</strong> Pay securely after approval</p><p><strong>04</strong> Receive service updates and photos</p></div></div>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <h3>Residential snow service</h3>
          <label>Service option<select value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>{plans.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
          <label>Your name<input autoComplete="name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className={styles.two}><label>Email<input autoComplete="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Phone<input type="tel" required minLength={7} maxLength={40} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label></div>
          <label>Property address<input autoComplete="street-address" required minLength={5} maxLength={250} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street number and name" /></label>
          <label>City<input required maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} /></label>
          <label>Notes (optional)<textarea maxLength={1200} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Driveway size, walkway, salting, special access..." /></label>
          <button type="submit" disabled={busy || confirmed} className={styles.primary}>{busy ? "Sending..." : confirmed ? "Request received" : "Send service request"}</button>
          {message && <p className={confirmed ? styles.success : styles.message} role="status">{message}</p>}
          <small>No payment is taken at this stage. Pricing and availability are confirmed individually.</small>
        </form>
      </section>
    </main>
    <footer className={styles.footer}><strong>4Ever Seasons</strong><span>Residential snow removal in Ontario</span><span><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></span></footer>
  </div>;
}
