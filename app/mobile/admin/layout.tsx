import "./mobile-admin.css";
import "./mobile-customers-add.css";
import {MobileAdminDirections} from "@/components/mobile/MobileAdminDirections";
import {MobileAddCustomerButton} from "@/components/mobile/MobileAddCustomerButton";
export default function MobileAdminLayout({children}:{children:React.ReactNode}){return <>{children}<MobileAdminDirections/><MobileAddCustomerButton/></>}
