import type { ReactNode } from "react";
import PlatformRegistrationAction from "@/components/master/PlatformRegistrationAction";
import { MasterCustomersShortcut } from "@/components/master/MasterCustomersShortcut";
import { MasterPaymentsShortcut } from "@/components/master/MasterPaymentsShortcut";
import { MasterTestAccessShortcut } from "@/components/master/MasterTestAccessShortcut";
import { MasterExperiencePolish } from "@/components/master/MasterExperiencePolish";
import { MasterRequestedPolish } from "@/components/master/MasterRequestedPolish";

export default function MasterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlatformRegistrationAction />
      <MasterCustomersShortcut />
      <MasterPaymentsShortcut />
      <MasterTestAccessShortcut />
      <MasterExperiencePolish />
      <MasterRequestedPolish />
      {children}
    </>
  );
}
