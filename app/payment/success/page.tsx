import Link from "next/link";

export default function PaymentSuccessPage() {
  return (
    <main className="payment-result-shell success">
      <section className="payment-result-card">
        <div className="payment-result-mark">✓</div>
        <span className="payment-result-kicker">Secure checkout completed</span>
        <h1>Payment submitted</h1>
        <p>Stripe accepted the checkout. We are confirming the payment and updating your invoice automatically.</p>
        <div className="payment-result-note">
          <strong>What happens next?</strong>
          <span>Your invoice changes to Paid after the signed Stripe confirmation arrives. This normally takes only a few seconds.</span>
        </div>
        <div className="payment-result-actions">
          <Link className="btn btn-primary" href="/customer/payments">View payment status</Link>
          <Link className="btn btn-outline" href="/customer">Customer home</Link>
        </div>
      </section>
    </main>
  );
}
