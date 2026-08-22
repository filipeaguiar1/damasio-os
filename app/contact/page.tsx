import type {Metadata} from "next";
import {Header} from "@/components/layout/Header";
import {Footer} from "@/components/layout/Footer";
import {ContactForm} from "./ContactForm";

export const metadata:Metadata={title:"Contact | 4 Ever Seasons",description:"Contact 4 Ever Seasons about property care in Oakville, Burlington and Hamilton."};

export default function ContactPage(){return <><Header/><main className="public-page"><section className="public-page-hero"><div className="public-page-shell"><span className="public-page-kicker">Contact</span><h1>Tell us what you need help with.</h1><p className="public-page-lead">Send a service question, property detail or account-support request. Messages from this form are routed to our support inbox.</p></div></section><section><div className="public-page-shell contact-layout"><aside className="contact-card"><span className="public-page-kicker">Direct support</span><h2 style={{fontSize:30}}>Prefer email?</h2><p>You can also reach us directly at:</p><p><a href="mailto:support@4everseasons.com"><strong>support@4everseasons.com</strong></a></p><p>For service-area questions, include the city and the type of property care you are looking for.</p></aside><div className="contact-card"><ContactForm/></div></div></section></main><Footer/></>}
