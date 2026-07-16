"use client";
import {useRouter} from "next/navigation";
export function MobileBackButton({fallback="/mobile/login"}:{fallback?:string}){const router=useRouter();return <button type="button" className="role-mobile-back" onClick={()=>router.replace(fallback)} aria-label="Go back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>}
