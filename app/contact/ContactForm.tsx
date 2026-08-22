"use client";

import {FormEvent,useState} from "react";

export function ContactForm(){
  const[status,setStatus]=useState<"idle"|"sending"|"success"|"error">("idle");
  const[message,setMessage]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setStatus("sending");setMessage("");
    const form=event.currentTarget;const data=new FormData(form);
    const payload={name:String(data.get("name")||""),email:String(data.get("email")||""),subject:String(data.get("subject")||""),message:String(data.get("message")||""),website:String(data.get("website")||"")};
    try{const response=await fetch("/api/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Unable to send your message.");setStatus("success");setMessage("Thanks. Your message was sent to our support team.");form.reset()}catch(error){setStatus("error");setMessage(error instanceof Error?error.message:"Unable to send your message. Please email support@4everseasons.com.")}
  }
  return <form className="contact-form" onSubmit={submit}>
    <div className="contact-form-row"><label>Name<input name="name" autoComplete="name" required maxLength={100}/></label><label>Email <span style={{fontWeight:500,color:"#6c7b73"}}>(optional)</span><input name="email" type="email" autoComplete="email" maxLength={160}/></label></div>
    <label>Subject<input name="subject" required maxLength={140} placeholder="How can we help?"/></label>
    <label>Message<textarea name="message" required minLength={10} maxLength={4000} placeholder="Tell us what you need help with, the property area, or any useful details."/></label>
    <label style={{position:"absolute",left:"-9999px",height:0,overflow:"hidden"}} aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label>
    <p className="contact-form-note">If you include an email address, we can reply directly to you.</p>
    <div><button className="btn btn-primary" type="submit" disabled={status==="sending"}>{status==="sending"?"Sending…":"Send message"}</button></div>
    {status!=="idle"&&message&&<div className={`contact-status ${status==="success"?"success":"error"}`} role="status">{message}</div>}
  </form>
}
