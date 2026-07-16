"use client";
import {RoleGuard} from "@/components/auth/RoleGuard";
export default function EmployeeLayout({children}:{children:React.ReactNode}){return <RoleGuard allowed={["employee"]}>{children}</RoleGuard>}
