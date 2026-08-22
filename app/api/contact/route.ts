import {NextRequest,NextResponse} from "next/server";

export const runtime="nodejs";

const WINDOW_MS=10*60*1000;
const MAX_REQUESTS=5;
const buckets=new Map<string,{count:number;reset:number}>();

function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max)}
function escapeHtml(value:string){return value.replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]||char))}
function validEmail(value:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)}
function allow(ip:string){const now=Date.now();const current=buckets.get(ip);if(!current||current.reset<now){buckets.set(ip,{count:1,reset:now+WINDOW_MS});return true}if(current.count>=MAX_REQUESTS)return false;current.count+=1;return true}

export async function POST(request:NextRequest){
  const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
  if(!allow(ip))return NextResponse.json({error:"Too many messages were sent from this connection. Please wait a few minutes and try again."},{status:429});
  let body:any;try{body=await request.json()}catch{return NextResponse.json({error:"Invalid request."},{status:400})}
  const name=clean(body.name,100),email=clean(body.email,160),subject=clean(body.subject,140),message=clean(body.message,4000),website=clean(body.website,200);
  if(website)return NextResponse.json({ok:true});
  if(name.length<2||subject.length<3||message.length<10)return NextResponse.json({error:"Please complete your name, subject and message."},{status:400});
  if(email&&!validEmail(email))return NextResponse.json({error:"Please enter a valid email address or leave the email field blank."},{status:400});
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey){console.error("Contact form is missing RESEND_API_KEY");return NextResponse.json({error:"Online messages are temporarily unavailable. Please email support@4everseasons.com."},{status:503})}
  const from=process.env.CONTACT_FROM_EMAIL||"4 Ever Seasons <no-reply@auth.4everseasons.com>";
  const html=`<div style="font-family:Arial,sans-serif;color:#17231d;line-height:1.6"><h2>New website message</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${email?escapeHtml(email):"Not provided"}</p><p><strong>Subject:</strong> ${escapeHtml(subject)}</p><hr style="border:0;border-top:1px solid #d9dfdb"/><p style="white-space:pre-wrap">${escapeHtml(message)}</p><hr style="border:0;border-top:1px solid #d9dfdb"/><small>Sent from the contact form at 4everseasons.com.</small></div>`;
  const payload:any={from,to:["support@4everseasons.com"],subject:`Website contact: ${subject}`,html};
  if(email)payload.reply_to=email;
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!response.ok){const detail=await response.text();console.error("Resend contact delivery failed",response.status,detail);return NextResponse.json({error:"We could not send your message right now. Please try again or email support@4everseasons.com."},{status:502})}
  return NextResponse.json({ok:true});
}
