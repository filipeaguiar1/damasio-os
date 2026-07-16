"use client";
import {useEffect,useState} from "react";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {MobileBackButton} from "@/components/mobile/MobileBackButton";
import {MobileAdminNav} from "@/components/mobile/MobileAdminNav";
import {DAMASIO_SYNC_EVENT,Notification,getNotifications,markNotificationsRead} from "@/lib/storage";

export default function MobileAdminAlerts(){
 const[items,setItems]=useState<Notification[]>([]);const[unreadOnly,setUnreadOnly]=useState(false);
 function refresh(){setItems(getNotifications())}
 useEffect(()=>{refresh();const update=()=>refresh();window.addEventListener(DAMASIO_SYNC_EVENT,update as EventListener);window.addEventListener("storage",update);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,update as EventListener);window.removeEventListener("storage",update)}},[]);
 const visible=unreadOnly?items.filter(item=>!item.read):items;const unread=items.filter(item=>!item.read).length;
 return <MobileRoleGuard allowed={["admin","manager"]}><main className="mobile-app-shell role-mobile-shell mobile-native-subpage"><header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/admin"/><div><strong>Alerts</strong><span>Activity and attention</span></div><button className="mobile-native-add mobile-native-check" onClick={()=>{markNotificationsRead();refresh()}} aria-label="Mark all read">✓</button></header><section className="mobile-native-hero alert"><span>LIVE INBOX</span><h1>{unread?`${unread} alert${unread===1?"":"s"} need attention.`:"You are all caught up."}</h1><p>Updates from routes, customers, payments and the field.</p></section><div className="mobile-native-toggle"><button className={!unreadOnly?"active":""} onClick={()=>setUnreadOnly(false)}>All <b>{items.length}</b></button><button className={unreadOnly?"active":""} onClick={()=>setUnreadOnly(true)}>Unread <b>{unread}</b></button></div><section className="mobile-alert-list">{visible.map(item=><article className={item.read?"read":""} key={item.id}><i>{item.type==="payment"?"$":item.type==="schedule"?"↗":item.type==="weather"?"☁":"!"}</i><div><span>{item.type}</span><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString("en-CA",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</small></div>{!item.read&&<b/>}</article>)}{!visible.length&&<div className="mobile-native-empty"><i>✓</i><strong>No alerts</strong><p>Nothing needs attention in this view.</p></div>}</section><MobileAdminNav active="alerts"/></main></MobileRoleGuard>
}
