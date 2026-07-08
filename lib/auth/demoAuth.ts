export type DemoRole = "admin" | "employee" | "customer";
export type DemoSession = { role: DemoRole; name: string; email: string; companyId: string; companyName: string };

export const DEMO_SESSIONS: Record<DemoRole, DemoSession> = {
  admin: { role: "admin", name: "Filipe Damasio", email: "admin@damasioos.demo", companyId: "demo-company", companyName: "Damasio Seasons" },
  employee: { role: "employee", name: "Field Employee", email: "employee@damasioos.demo", companyId: "demo-company", companyName: "Damasio Seasons" },
  customer: { role: "customer", name: "Customer Demo", email: "customer@damasioos.demo", companyId: "demo-company", companyName: "Damasio Seasons" },
};

export function getRoleHome(role: DemoRole){
  if(role==="admin") return "/admin";
  if(role==="employee") return "/employee";
  return "/customer";
}

export function saveDemoSession(role: DemoRole){
  if(typeof window==="undefined") return;
  window.localStorage.setItem("damasio_os_session", JSON.stringify(DEMO_SESSIONS[role]));
}

export function readDemoSession(): DemoSession | null{
  if(typeof window==="undefined") return null;
  const raw=window.localStorage.getItem("damasio_os_session");
  if(!raw) return null;
  try{return JSON.parse(raw) as DemoSession}catch{return null}
}

export function clearDemoSession(){
  if(typeof window!=="undefined") window.localStorage.removeItem("damasio_os_session");
}
