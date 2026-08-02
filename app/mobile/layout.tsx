import type { ReactNode } from "react";
import { MobileAutoUpdater } from "@/components/mobile/MobileAutoUpdater";
import { MobileOperationStatus } from "@/components/mobile/MobileOperationStatus";

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MobileAutoUpdater />
      <MobileOperationStatus />
      {children}
    </>
  );
}
