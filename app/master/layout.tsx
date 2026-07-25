import type { ReactNode } from "react";
import PlatformRegistrationAction from "@/components/master/PlatformRegistrationAction";

export default function MasterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlatformRegistrationAction />
      {children}
    </>
  );
}
