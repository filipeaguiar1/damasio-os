import type { ReactNode } from "react";
import PlatformRegistrationAction from "@/components/master/PlatformRegistrationAction";
import { MasterCustomersShortcut } from "@/components/master/MasterCustomersShortcut";
import { MasterPaymentsShortcut } from "@/components/master/MasterPaymentsShortcut";
import { MasterPaymentHealthShortcut } from "@/components/master/MasterPaymentHealthShortcut";
import { MasterPricingShortcut } from "@/components/master/MasterPricingShortcut";
import { MasterTestAccessShortcut } from "@/components/master/MasterTestAccessShortcut";

export default function MasterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlatformRegistrationAction />
      <MasterCustomersShortcut />
      <MasterPaymentsShortcut />
      <MasterPaymentHealthShortcut />
      <MasterPricingShortcut />
      <MasterTestAccessShortcut />
      {children}
    </>
  );
}
