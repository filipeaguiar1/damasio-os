import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/home/Hero";
import { Features } from "@/components/home/Features";
import { Services } from "@/components/home/Services";
import { Membership } from "@/components/home/Membership";
import { Portals } from "@/components/home/Portals";
import { FAQ } from "@/components/home/FAQ";
import { AuthLinkRouter } from "@/components/auth/AuthLinkRouter";

export default function HomePage() {
  return (
    <>
      <AuthLinkRouter />
      <Header />
      <main className="public-home">
        <Hero />
        <Features />
        <Services />
        <Membership />
        <Portals />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
