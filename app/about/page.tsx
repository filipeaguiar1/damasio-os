import type {Metadata} from "next";
import Link from "next/link";
import {Header} from "@/components/layout/Header";
import {Footer} from "@/components/layout/Footer";

export const metadata:Metadata={title:"About | 4 Ever Seasons",description:"Learn how 4 Ever Seasons approaches reliable property care across Oakville, Burlington and Hamilton."};

const gallery=[
  ["Lawn care","Consistent cuts, clean edges and tidy finish."],
  ["Seasonal cleanup","Spring and fall cleanup planned around the property."],
  ["Garden & bed care","Practical upkeep for beds, borders and visible details."],
  ["Snow service","Clear access and straightforward winter service updates."],
  ["Property maintenance","Routine work organized around what the property actually needs."]
];

export default function AboutPage(){return <><Header/><main className="public-page">
  <section className="public-page-hero"><div className="public-page-shell"><span className="public-page-kicker">About 4 Ever Seasons</span><h1>Property care that is easy to understand and easy to keep on track.</h1><p className="public-page-lead">We focus on the everyday work that keeps a property looking cared for through the changing seasons. Clear scope, reliable scheduling and straightforward communication matter just as much as the work itself.</p><div className="public-page-cta"><a className="btn btn-primary" href="/#quote">Get a quote</a><Link className="btn btn-outline" href="/contact">Contact us</Link></div></div></section>
  <section><div className="public-page-shell public-page-split"><div><span className="public-page-kicker">How we work</span><h2>Simple standards, followed consistently.</h2></div><ul className="public-page-list"><li><strong>Clear service scope.</strong><br/>You should know what is being completed before the visit starts.</li><li><strong>Property-specific details.</strong><br/>Access notes, service preferences and recurring needs stay attached to the right property.</li><li><strong>Practical communication.</strong><br/>Quotes, scheduled work and customer updates are kept organized in one place.</li><li><strong>Season-aware planning.</strong><br/>Lawn care, cleanups, garden maintenance and winter service are handled as different kinds of work, not one generic package.</li></ul></div></section>
  <section className="section-white"><div className="public-page-shell"><span className="public-page-kicker">What we care about</span><div className="public-page-grid"><article className="public-page-panel"><h3>Reliability</h3><p>Schedules should be realistic, service details should be visible and customers should not have to guess what happens next.</p></article><article className="public-page-panel"><h3>Property context</h3><p>Every address is different. Access, gates, lawn size, recurring preferences and notes belong with the property, not in someone&apos;s memory.</p></article><article className="public-page-panel"><h3>Clean handoff</h3><p>From quote to scheduled visit to completed work, information should carry forward without making the customer repeat it.</p></article></div></div></section>
  <section><div className="public-page-shell"><span className="public-page-kicker">Project gallery</span><h2>Built to show real completed work.</h2><p className="public-page-lead">The gallery is ready for genuine project photos. We are deliberately not using generated images as stand-ins for customer work.</p><div className="project-gallery"><div className="project-gallery-track">{gallery.map(([title,copy])=><figure className="project-gallery-card" key={title}><div className="project-gallery-placeholder"><div><strong>{title}</strong><span>Real project photo slot</span></div></div><figcaption>{copy}</figcaption></figure>)}</div></div></div></section>
  <section className="section-white"><div className="public-page-shell public-page-split"><div><span className="public-page-kicker">Local service area</span><h2>Oakville, Burlington and Hamilton.</h2></div><div><p>Our public service area is focused on these communities so quoting and scheduling can stay realistic. If you are nearby and unsure whether your address is covered, send us a note and we can confirm.</p><Link className="btn btn-primary" href="/contact">Ask about your property</Link></div></div></section>
</main><Footer/></>}
