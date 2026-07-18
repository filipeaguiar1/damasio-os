import "./mobile-admin.css";
import {MobileAdminDirections} from "@/components/mobile/MobileAdminDirections";
export default function MobileAdminLayout({children}:{children:React.ReactNode}){return <>{children}<MobileAdminDirections/></>}
