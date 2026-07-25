"use client";

import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileCustomerNav } from "@/components/mobile/MobileCustomerNav";
import { CustomerPropertyEditor } from "@/components/customer/CustomerPropertyEditor";

export default function MobileCustomerPropertyPage() {
  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell role-mobile-shell mobile-customer-subpage"><header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/customer"/><div><strong>My Property</strong><span>House photo and property details</span></div><span className="role-mobile-avatar">⌂</span></header><section className="customer-native-hero profile"><span>PRIMARY PROPERTY</span><h1>My Property</h1><p>Service specifications are controlled by Admin or Master.</p></section><CustomerPropertyEditor mobile/><MobileCustomerNav active="more"/></main></MobileRoleGuard>;
}
