import type {ReactNode} from "react";
import {MobileAutoUpdater} from "@/components/mobile/MobileAutoUpdater";
export default function MobileLayout({children}:{children:ReactNode}){return <><MobileAutoUpdater/>{children}</>}
