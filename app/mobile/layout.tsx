import type {ReactNode} from "react";
import {MobileAutoUpdater} from "@/components/mobile/MobileAutoUpdater";
import {EmployeeMobilePolish} from "@/components/mobile/EmployeeMobilePolish";

export default function MobileLayout({children}:{children:ReactNode}){
  return <><MobileAutoUpdater/><EmployeeMobilePolish/>{children}</>;
}
