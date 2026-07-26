import { PremiumEmployeeNav } from "@/components/mobile/PremiumEmployeeNav";

export default function MobileEmployeeLayout({children}:{children:React.ReactNode}){
  return <>{children}<PremiumEmployeeNav/></>;
}
