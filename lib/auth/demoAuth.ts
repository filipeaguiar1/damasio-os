export type DemoRole = "master" | "admin" | "employee" | "customer";
export type DemoSession = { role: DemoRole; name: string; email: string; companyId: string; companyName: string };

export const DEMO_SESSIONS: Record<DemoRole, DemoSession> = {
  master: { role: "master", name: "Disabled", email: "", companyId: "", companyName: "" },
  admin: { role: "admin", name: "Disabled", email: "", companyId: "", companyName: "" },
  employee: { role: "employee", name: "Disabled", email: "", companyId: "", companyName: "" },
  customer: { role: "customer", name: "Disabled", email: "", companyId: "", companyName: "" },
};

export function getRoleHome(role: DemoRole){
  if(role==="master") return "/master";
  if(role==="admin") return "/admin";
  if(role==="employee") return "/employee";
  return "/customer";
}

export function saveDemoSession(_role: DemoRole){
  clearDemoSession();
  throw new Error("Demo access has been removed. Sign in with a live account.");
}

export function readDemoSession(): DemoSession | null{
  clearDemoSession();
  return null;
}

export function clearDemoSession(){
  if(typeof window!=="undefined") window.localStorage.removeItem("damasio_os_session");
}
