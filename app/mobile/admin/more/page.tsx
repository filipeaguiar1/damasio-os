"use client";
import Link from "next/link";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {MobileBackButton} from "@/components/mobile/MobileBackButton";
import {MobileAdminNav} from "@/components/mobile/MobileAdminNav";
const groups=[["Customers","◎","/admin/customers"],["Estimates","▤","/admin/estimates"],["Invoices","$","/admin/invoices"],["Requests","＋","/admin/requests"],["Employees","♧","/admin/employees"],["Finance","◈","/admin/finance"],["Reports","▥","/admin/performance"],["Settings","⚙","/admin/settings"]];
export default function MobileAdminMore(){return <MobileRoleGuard allowed={["admin","manager"]}><main className="mobile-app-shell role-mobile-shell mobile-native-subpage"><header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/admin"/><div><strong>More</strong><span>Business tools</span></div><span className="role-mobile-avatar">A</span></header><section className="mobile-native-hero"><span>ADMIN TOOLS</span><h1>Everything else, organized.</h1><p>Core mobile tools stay in the bottom navigation.</p></section><section className="mobile-more-grid">{groups.map(([label,icon,href])=><Link href={href} key={label}><i>{icon}</i><strong>{label}</strong><span>Open tool ›</span></Link>)}</section><MobileAdminNav active="more"/></main></MobileRoleGuard>}
