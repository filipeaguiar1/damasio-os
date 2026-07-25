import type { ReactNode } from "react";
import PlatformRegistrationAction from "@/components/master/PlatformRegistrationAction";
import { MasterCustomersShortcut } from "@/components/master/MasterCustomersShortcut";

export default function MasterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlatformRegistrationAction />
      <MasterCustomersShortcut />
      {children}
    </>
  );
}
