"use client";
import {usePathname,useRouter} from "next/navigation";
export function MobileAddCustomerButton(){const pathname=usePathname();const router=useRouter();if(pathname!=="/mobile/admin/customers")return null;return <button type="button" className="mobile-customers-add" onClick={()=>router.push("/mobile/admin/add-customer")}><span>＋</span><div><strong>Add Customer</strong><small>Customer, property, service and photo</small></div></button>}
