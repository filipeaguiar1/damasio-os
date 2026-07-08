import Link from "next/link";

export default function PaymentSuccessPage() {
  return (
    <main className="section section-white">
      <div className="container">
        <div className="card profile-card">
          <span className="eyebrow">Payment</span>
          <h1>Payment received</h1>
          <p className="section-intro">Thank you. Your payment was processed successfully.</p>
          <Link className="btn btn-primary" href="/">Back to website</Link>
        </div>
      </div>
    </main>
  );
}
