export function Footer() {
  return <footer className="footer">
    <style>{`
      .footer .footer-link{display:block;width:max-content;max-width:100%;color:rgba(255,255,255,.74);margin:0 0 12px;padding:3px 0;position:relative;transition:color .16s ease,transform .16s ease}
      .footer .footer-link:after{content:"";position:absolute;left:0;bottom:0;width:0;height:1px;background:rgba(255,255,255,.72);transition:width .16s ease}
      .footer .footer-link:hover,.footer .footer-link:focus-visible{color:#fff;transform:translateX(3px)}
      .footer .footer-link:hover:after,.footer .footer-link:focus-visible:after{width:100%}
      @media(prefers-reduced-motion:reduce){.footer .footer-link{transition:none}.footer .footer-link:hover,.footer .footer-link:focus-visible{transform:none}}
    `}</style>
    <div className="container footer-grid">
      <div><h3>4Ever Seasons</h3><p>Professional property maintenance and landscaping in Hamilton, Burlington and Oakville.</p></div>
      <div><h4>Services</h4><a className="footer-link" href="/#services">Lawn Care</a><a className="footer-link" href="/#services">Spring Cleanup</a><a className="footer-link" href="/#services">Fall Cleanup</a><a className="footer-link" href="/#services">Snow Removal</a></div>
      <div><h4>Portals</h4><a className="footer-link" href="/customer">Customer Portal</a><a className="footer-link" href="/employee">Employee App</a><a className="footer-link" href="/admin">Admin CRM</a><a className="footer-link" href="/customer/payments">Finance</a></div>
      <div><h4>Payments</h4><a className="footer-link" href="/#payments">Secure card checkout</a><a className="footer-link" href="/#payments">Interac e-Transfer</a><a className="footer-link" href="/#payments">Cash or cheque</a><a className="footer-link" href="/#payments">Online invoices</a></div>
    </div>
  </footer>;
}
