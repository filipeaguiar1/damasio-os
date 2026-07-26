import type { ReactNode } from "react";
import PlatformRegistrationAction from "@/components/master/PlatformRegistrationAction";
import { MasterCustomersShortcut } from "@/components/master/MasterCustomersShortcut";
import { MasterPaymentsShortcut } from "@/components/master/MasterPaymentsShortcut";

export default function MasterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlatformRegistrationAction />
      <MasterCustomersShortcut />
      <MasterPaymentsShortcut />
      {children}
    </>
  );
}
