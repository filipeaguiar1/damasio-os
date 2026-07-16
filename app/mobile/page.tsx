"use client";

import {useRouter} from "next/navigation";
import {MobileStartupSplash} from "@/components/mobile/MobileStartupSplash";

export default function MobileEntry(){
  const router=useRouter();
  return <MobileStartupSplash showMark={false} message="Preparing your mobile workspace..." onOpen={()=>router.replace("/mobile/login")}/>;
}
