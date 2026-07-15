import type {DemoRole} from "@/lib/auth/demoAuth";

export type MobileRole=DemoRole|"manager";

export function getMobileRoleHome(role:string){
  if(role==="master")return "/master";
  if(role==="admin"||role==="manager")return "/mobile/admin";
  if(role==="employee")return "/mobile/employee";
  if(role==="customer")return "/mobile/customer";
  return "/mobile/login";
}
