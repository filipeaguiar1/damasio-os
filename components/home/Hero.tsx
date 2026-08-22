import { QuoteWizard } from "./QuoteWizard";

export function Hero() {
  return <section className="hero public-hero">
    <style>{`
      .public-home .hero-grid{
        align-items:start!important;
      }
      .public-home .hero-copy{
        padding-top:4px;
      }
      .public-home .hero-brand-title{
        display:block;
        font-size:clamp(64px,8vw,104px);
        line-height:.84;
        letter-spacing:-.075em;
        font-weight:950;
        color:#0a3023;
      }
      .public-home .hero-brand-subtitle{
        display:block;
        margin-top:16px;
        max-width:620px;
        font-size:clamp(19px,2vw,28px);
        line-height:1.16;
        letter-spacing:-.035em;
        font-weight:720;
        color:#48695b;
      }
      .public-home .hero-copy h1{
        max-width:760px;
        margin-bottom:0;
      }
      .public-home .hero-actions{
        margin-top:30px;
        gap:14px;
      }
      .public-home .hero-customer-link{
        background:#ffffff!important;
        color:#0f5132!important;
        border:1.5px solid #0f5132!important;
        box-shadow:0 10px 26px rgba(13,61,44,.1)!important;
        transition:transform .18s ease,box-shadow .18s ease,background .18s ease!important;
      }
      .public-home .hero-customer-link:hover{
        background:#eaf6ee!important;
        color:#0b3f27!important;
        border-color:#0b3f27!important;
        transform:scale(1.025);
        box-shadow:0 14px 32px rgba(13,61,44,.13)!important;
      }
      .public-home .hero-customer-link:focus-visible{
        outline:3px solid rgba(15,81,50,.32);
        outline-offset:3px;
      }
      .public-home .hero-proof-grid{
        margin-top:36px;
      }
      .public-home .hero-proof{
        background:rgba(255,255,255,.88);
        border:1.35px solid rgba(13,61,44,.18)!important;
        box-shadow:0 12px 34px rgba(13,61,44,.06);
      }
      .public-home .public-hero{
        padding-top:92px;
        padding-bottom:108px;
      }
      @media(max-width:1000px){
        .public-home .public-hero{padding-top:58px;padding-bottom:76px}
        .public-home .hero-copy{padding-top:0}
      }
      @media(max-width:620px){
        .public-home .hero-brand-title{font-size:58px}
        .public-home .hero-brand-subtitle{font-size:20px;margin-top:13px}
        .public-home .hero-actions .btn{width:100%}
      }
      @media(prefers-reduced-motion:reduce){
        .public-home .hero-customer-link:hover{transform:none}
      }
    `}</style>
    <div className="container hero-grid">
      <div className="hero-copy">
        <span className="eyebrow">Hamilton • Burlington • Oakville</span>
        <h1>
          <span className="hero-brand-title">4Ever Seasons</span>
          <span className="hero-brand-subtitle">One simple way to care for your property.</span>
        </h1>
        <div className="hero-actions">
          <a className="btn btn-primary hero-primary" href="#quote">Get Instant Quote</a>
          <a className="btn btn-outline hero-customer-link" href="/customer">Customer Portal</a>
        </div>
        <div className="hero-proof-grid">
          <div className="hero-proof"><span>01</span><strong>Quick estimate</strong><small>Simple guided questions</small></div>
          <div className="hero-proof"><span>02</span><strong>Clear service</strong><small>Updates in one place</small></div>
          <div className="hero-proof"><span>03</span><strong>Easy payments</strong><small>Online invoice experience</small></div>
        </div>
      </div>
      <div id="quote" className="hero-quote-shell"><QuoteWizard /></div>
    </div>
  </section>;
}
