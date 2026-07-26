"use client";
import {RoleGuard} from "@/components/auth/RoleGuard";
import "./customer-services.css";
import "./payments-visits.css";
export default function CustomerLayout({children}:{children:React.ReactNode}){return <RoleGuard allowed={["customer"]}>{children}</RoleGuard>}
