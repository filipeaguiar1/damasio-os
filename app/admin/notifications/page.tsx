"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getNotifications, markNotificationsRead, Notification, seedDemoLeads } from "@/lib/storage";

export default function NotificationsPage(){
  const [items,setItems]=useState<Notification[]>([]);
  function refresh(){setItems(getNotifications())}
  useEffect(()=>refresh(),[]);
  return <AdminShell active="Notifications">
    <div className="app-top"><div><span className="eyebrow">Notifications</span><h1>Notification Center</h1><p className="section-intro">Lead, schedule, payment, review and system alerts.</p></div><div className="row"><button className="btn btn-outline" onClick={()=>{seedDemoLeads(true);refresh()}}>Load Demo</button><button className="btn btn-primary" onClick={()=>{markNotificationsRead();refresh()}}>Mark Read</button></div></div>
    <div className="notification-list">{items.length===0?<div className="card profile-card"><h3>No notifications yet</h3></div>:items.map(n=><div key={n.id} className={n.read?"notification-item":"notification-item unread"}><strong>{n.title}</strong><p>{n.message}</p><small>{n.type} • {new Date(n.createdAt).toLocaleString()}</small></div>)}</div>
  </AdminShell>
}
