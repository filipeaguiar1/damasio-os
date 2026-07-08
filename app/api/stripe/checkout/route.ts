import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const amount = Number(body.amount || 0);
  const customerEmail = String(body.customerEmail || "");
  const customerName = String(body.customerName || "Damasio Seasons Customer");
  const leadId = String(body.leadId || "");

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({
      message: "Stripe is not configured yet. Add STRIPE_SECRET_KEY in .env.local to activate card payments."
    });
  }

  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    return NextResponse.json({
      message: "NEXT_PUBLIC_SITE_URL is missing. Add it to .env.local."
    });
  }

  if (!amount || amount <= 0) {
    return NextResponse.json({
      message: "This quote has no amount to charge yet. Extra services need manual pricing first."
    });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-06-24.dahlia"
  });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: customerEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: "Damasio Seasons Quote",
            description: customerName
          }
        }
      }
    ],
    metadata: { leadId },
    success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/payment/success?leadId=${leadId}`,
    cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/payment/cancel?leadId=${leadId}`
  });

  return NextResponse.json({ url: session.url });
}
