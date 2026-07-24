import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/home/Hero";
import { Features } from "@/components/home/Features";
import { Services } from "@/components/home/Services";
import { Membership } from "@/components/home/Membership";
import { Portals } from "@/components/home/Portals";
import { FAQ } from "@/components/home/FAQ";

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
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
