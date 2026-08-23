"use client";

import { FormEvent, useState } from "react";

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || ""),
      email: String(data.get("email") || ""),
      subject: String(data.get("subject") || ""),
      message: String(data.get("message") || ""),
      website: String(data.get("website") || ""),
    };

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to send your message.");
      setStatus("success");
      setMessage("Message sent. We will reply to the email address you provided.");
      form.reset();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to send your message. Please email support@4everseasons.com.");
    }
  }

  return <form className="contact-form" onSubmit={submit}>
    <div className="contact-form-row">
      <label>Full name<input name="name" autoComplete="name" required maxLength={100} placeholder="Your name" /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required maxLength={160} placeholder="you@example.com" /></label>
    </div>
    <label>Subject<input name="subject" required maxLength={140} placeholder="Quote, service question, account support..." /></label>
    <label>Message<textarea name="message" required minLength={10} maxLength={4000} placeholder="Add the property city, service type and any details that will help us understand the request." /></label>
    <label className="contact-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    <p className="contact-form-note">We use the information in this form to respond to your request. See our <a href="/privacy">Privacy Policy</a>.</p>
    <div><button className="btn btn-primary contact-submit" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending..." : "Send message"}</button></div>
    {status !== "idle" && message && <div className={`contact-status ${status === "success" ? "success" : "error"}`} role="status">{message}</div>}
  </form>;
}
