"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Expense, ExpenseCategory, getExpenses, saveExpense, seedDemoExpenses, clearExpenses } from "@/lib/storage";

export default function ExpensesPage(){
  const [expenses,setExpenses]=useState<Expense[]>([]);
  const [form,setForm]=useState({date:"",vendor:"",category:"fuel" as ExpenseCategory,amount:"",notes:""});
  function refresh(){setExpenses(getExpenses())}
  useEffect(()=>refresh(),[]);
  const total=expenses.reduce((s,e)=>s+e.amount,0);

  function add(){
    saveExpense({id:crypto.randomUUID(),createdAt:new Date().toISOString(),date:form.date||new Date().toISOString().slice(0,10),vendor:form.vendor,category:form.category,amount:Number(form.amount||0),notes:form.notes});
    setForm({date:"",vendor:"",category:"fuel",amount:"",notes:""});
    refresh();
  }

  return <AdminShell active="Expenses">
    <div className="app-top"><div><span className="eyebrow">Finance</span><h1>Expenses</h1><p className="section-intro">Track fuel, maintenance, materials and other costs for tax reporting.</p></div><div className="row"><button className="btn btn-outline" onClick={()=>{seedDemoExpenses();refresh()}}>Load Demo</button><button className="btn btn-outline" onClick={()=>{clearExpenses();refresh()}}>Clear</button></div></div>
    <div className="grid-3" style={{marginBottom:20}}><div className="card dash-card"><div className="mini-label">Total Expenses</div><div className="mini-value">${total.toFixed(2)}</div></div><div className="card dash-card"><div className="mini-label">Records</div><div className="mini-value">{expenses.length}</div></div><div className="card dash-card"><div className="mini-label">Export</div><div className="mini-value">CSV</div></div></div>
    <div className="card profile-card" style={{marginBottom:20}}><h2>Add Expense</h2><div className="form-grid"><div className="field"><label>Date</label><input className="input" type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></div><div className="field"><label>Vendor</label><input className="input" value={form.vendor} onChange={e=>setForm({...form,vendor:e.target.value})}/></div><div className="field"><label>Category</label><select className="input" value={form.category} onChange={e=>setForm({...form,category:e.target.value as ExpenseCategory})}><option value="fuel">Fuel</option><option value="equipment">Equipment</option><option value="maintenance">Maintenance</option><option value="materials">Materials</option><option value="insurance">Insurance</option><option value="marketing">Marketing</option><option value="other">Other</option></select></div><div className="field"><label>Amount</label><input className="input" type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></div></div><div className="field"><label>Notes</label><input className="input" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div><button className="btn btn-primary" onClick={add}>Add Expense</button></div>
    <section className="card table-card"><div className="table-wrap"><table><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Notes</th></tr></thead><tbody>{expenses.length===0?<tr><td colSpan={5}>No expenses yet.</td></tr>:expenses.map(e=><tr key={e.id}><td>{e.date}</td><td>{e.vendor}</td><td><span className="expense-category">{e.category}</span></td><td>${e.amount.toFixed(2)}</td><td>{e.notes}</td></tr>)}</tbody></table></div></section>
  </AdminShell>
}
