"use client";

import { PortalShell } from "@/components/admin/PortalShell";
import { CustomerPropertyEditor } from "@/components/customer/CustomerPropertyEditor";

export default function CustomerPropertyPage() {
  return <PortalShell type="Customer" active="My Property"><div className="property-center-hero"><div><span>MY PROPERTY</span><h1>Property profile</h1><p>House photo, locked service specifications and your customer comment.</p></div></div><CustomerPropertyEditor /></PortalShell>;
}
