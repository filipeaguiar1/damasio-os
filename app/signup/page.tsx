import Link from "next/link";

export default function SignupDisabledPage(){
  return <main className="auth-page">
    <section className="auth-card wide">
      <span className="eyebrow">Onboarding paused</span>
      <h1>Company signup is not active yet</h1>
      <p>We removed the company creation flow from this version to avoid errors while the real database is being connected. The system will continue with demo access and database setup first.</p>
      <div className="hero-actions">
        <Link className="btn btn-primary" href="/login">Go to Login</Link>
        <Link className="btn btn-white" href="/admin/database">Database Setup</Link>
      </div>
    </section>
  </main>;
}
