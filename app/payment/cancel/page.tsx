import Link from "next/link";

export default function PaymentCancelPage() {
  return (
    <main className="section section-white">
      <div className="container">
        <div className="card profile-card">
          <span className="eyebrow">Payment</span>
          <h1>Payment cancelled</h1>
          <p className="section-intro">No payment was taken. You can return to the quote page and choose another method.</p>
          <Link className="btn btn-primary" href="/">Back to quote</Link>
        </div>
      </div>
    </main>
  );
}
