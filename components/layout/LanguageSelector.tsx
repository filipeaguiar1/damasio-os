"use client";
import {useEffect,useRef,useState} from "react";

const languages={en:"English",pt:"Português",fr:"Français",es:"Español"} as const;
type Lang=keyof typeof languages;
const helper:Record<Lang,string>={en:"Site language",pt:"Idioma do site",fr:"Langue du site",es:"Idioma del sitio"};
const dictionary:Record<Lang,Record<string,string>>={
  en:{},
  pt:{
    "Dashboard":"Painel","CRM":"CRM","Estimates":"Orçamentos","Customers":"Clientes","Routes":"Rotas","Calendar":"Calendário","Crews":"Equipes","Finance":"Financeiro","Invoices":"Faturas","Alerts":"Alertas","Reports":"Relatórios","Settings":"Configurações","Services":"Serviços","Plans":"Planos","Customer":"Cliente","Employee":"Funcionário","Admin":"Administrador","Administrator":"Administrador","Get Quote":"Solicitar orçamento","Get Instant Quote":"Orçamento instantâneo","Customer Portal":"Portal do cliente","Employee Portal":"Portal do funcionário","Today":"Hoje","Checklist":"Checklist","Route":"Rota","Photos":"Fotos","Hours":"Horas","Training":"Treinamento","Profile":"Perfil","Requests":"Solicitações","Feedback":"Avaliação","Website":"Site","Need Help?":"Precisa de ajuda?","Contact Support":"Falar com suporte","Search customers":"Buscar clientes","Theme settings":"Configurações de tema","Good Morning":"Bom dia","Weekly Calendar":"Calendário semanal","Week View":"Semana","Month View":"Mês","Previous Week":"Semana anterior","Next Week":"Próxima semana","Previous Month":"Mês anterior","Next Month":"Próximo mês","Create Route":"Criar rota","Completed":"Concluído","Booked":"Agendado","Needs booking soon":"Precisa agendar em breve","Needs booking":"Precisa agendar","Overdue":"Atrasado","All Crews":"Todas as equipes","Open Routes":"Abrir rotas","Assign Homes":"Atribuir casas","No homes scheduled":"Nenhuma casa agendada","Lead Pipeline":"Pipeline de leads","New":"Novo","NEW":"NOVO","BOOKED":"AGENDADO","QUOTED":"ORÇADO","LOST":"PERDIDO","COMPLETED":"CONCLUÍDO","Pending Payments":"Pagamentos pendentes","Get directions":"Abrir navegação","Directions":"Navegação","Previous":"Anterior","Next":"Próximo","Open":"Abrir","Lost":"Perdido","Quoted":"Orçado","Paid":"Pago","Pending":"Pendente","Revenue":"Receita","Expenses":"Despesas","Profit":"Lucro","No fixed visit hours. Manage days, route order and booking status.":"Sem horários fixos. Gerencie dias, ordem da rota e status de agendamento.","No homes assigned to this crew/day yet. Use Customers to assign homes first.":"Nenhuma casa atribuída a esta equipe/dia. Use Clientes para atribuir casas primeiro.","No homes":"Sem casas","Homes":"Casas","Home":"Casa","All set":"Tudo certo","Great job!":"Ótimo trabalho!","Next 3 days":"Próximos 3 dias","Needs action":"Precisa de ação","You're all caught up!":"Tudo em dia!"
  },
  fr:{
    "Dashboard":"Tableau de bord","CRM":"CRM","Estimates":"Devis","Customers":"Clients","Routes":"Itinéraires","Calendar":"Calendrier","Crews":"Équipes","Finance":"Finances","Invoices":"Factures","Alerts":"Alertes","Reports":"Rapports","Settings":"Paramètres","Services":"Services","Plans":"Forfaits","Customer":"Client","Employee":"Employé","Admin":"Admin","Administrator":"Administrateur","Get Quote":"Demander un devis","Get Instant Quote":"Devis instantané","Customer Portal":"Portail client","Employee Portal":"Portail employé","Today":"Aujourd’hui","Checklist":"Liste","Route":"Itinéraire","Photos":"Photos","Hours":"Heures","Training":"Formation","Profile":"Profil","Requests":"Demandes","Feedback":"Avis","Website":"Site web","Need Help?":"Besoin d’aide?","Contact Support":"Contacter le support","Search customers":"Rechercher des clients","Theme settings":"Paramètres du thème","Good Morning":"Bonjour","Weekly Calendar":"Calendrier hebdomadaire","Week View":"Semaine","Month View":"Mois","Previous Week":"Semaine précédente","Next Week":"Semaine suivante","Previous Month":"Mois précédent","Next Month":"Mois suivant","Create Route":"Créer un itinéraire","Completed":"Terminé","Booked":"Réservé","Needs booking soon":"À réserver bientôt","Needs booking":"À réserver","Overdue":"En retard","All Crews":"Toutes les équipes","Open Routes":"Ouvrir les itinéraires","Assign Homes":"Assigner des maisons","No homes scheduled":"Aucune maison planifiée","Lead Pipeline":"Pipeline de prospects","New":"Nouveau","NEW":"NOUVEAU","BOOKED":"RÉSERVÉ","QUOTED":"DEVIS","LOST":"PERDU","COMPLETED":"TERMINÉ","Pending Payments":"Paiements en attente","Get directions":"Ouvrir la navigation","Directions":"Navigation","Previous":"Précédent","Next":"Suivant","Open":"Ouvrir","Lost":"Perdu","Quoted":"Devis","Paid":"Payé","Pending":"En attente","Revenue":"Revenu","Expenses":"Dépenses","Profit":"Profit","No fixed visit hours. Manage days, route order and booking status.":"Pas d’heures fixes. Gérez les jours, l’ordre des itinéraires et le statut.","No homes assigned to this crew/day yet. Use Customers to assign homes first.":"Aucune maison assignée à cette équipe/jour. Utilisez Clients d’abord.","No homes":"Aucune maison","Homes":"Maisons","Home":"Maison","All set":"Prêt","Great job!":"Bon travail!","Next 3 days":"Prochains 3 jours","Needs action":"Action requise","You're all caught up!":"Tout est à jour!"
  },
  es:{
    "Dashboard":"Panel","CRM":"CRM","Estimates":"Cotizaciones","Customers":"Clientes","Routes":"Rutas","Calendar":"Calendario","Crews":"Equipos","Finance":"Finanzas","Invoices":"Facturas","Alerts":"Alertas","Reports":"Reportes","Settings":"Configuración","Services":"Servicios","Plans":"Planes","Customer":"Cliente","Employee":"Empleado","Admin":"Admin","Administrator":"Administrador","Get Quote":"Pedir cotización","Get Instant Quote":"Cotización instantánea","Customer Portal":"Portal del cliente","Employee Portal":"Portal del empleado","Today":"Hoy","Checklist":"Lista","Route":"Ruta","Photos":"Fotos","Hours":"Horas","Training":"Capacitación","Profile":"Perfil","Requests":"Solicitudes","Feedback":"Evaluación","Website":"Sitio web","Need Help?":"¿Necesitas ayuda?","Contact Support":"Contactar soporte","Search customers":"Buscar clientes","Theme settings":"Configuración de tema","Good Morning":"Buenos días","Weekly Calendar":"Calendario semanal","Week View":"Semana","Month View":"Mes","Previous Week":"Semana anterior","Next Week":"Próxima semana","Previous Month":"Mes anterior","Next Month":"Próximo mes","Create Route":"Crear ruta","Completed":"Completado","Booked":"Agendado","Needs booking soon":"Necesita agendar pronto","Needs booking":"Necesita agendar","Overdue":"Atrasado","All Crews":"Todos los equipos","Open Routes":"Abrir rutas","Assign Homes":"Asignar casas","No homes scheduled":"No hay casas agendadas","Lead Pipeline":"Pipeline de leads","New":"Nuevo","NEW":"NUEVO","BOOKED":"AGENDADO","QUOTED":"COTIZADO","LOST":"PERDIDO","COMPLETED":"COMPLETADO","Pending Payments":"Pagos pendientes","Get directions":"Abrir navegación","Directions":"Navegación","Previous":"Anterior","Next":"Siguiente","Open":"Abrir","Lost":"Perdido","Quoted":"Cotizado","Paid":"Pagado","Pending":"Pendiente","Revenue":"Ingresos","Expenses":"Gastos","Profit":"Ganancia","No fixed visit hours. Manage days, route order and booking status.":"Sin horarios fijos. Administra días, orden de ruta y estado.","No homes assigned to this crew/day yet. Use Customers to assign homes first.":"No hay casas asignadas a este equipo/día. Usa Clientes primero.","No homes":"Sin casas","Homes":"Casas","Home":"Casa","All set":"Todo listo","Great job!":"¡Buen trabajo!","Next 3 days":"Próximos 3 días","Needs action":"Necesita acción","You're all caught up!":"Todo al día!"
  }
};

const originalText=new WeakMap<Text,string>();
function translateText(raw:string,lang:Lang){
  if(lang==="en")return raw;
  const map=dictionary[lang];
  const trimmed=raw.trim();
  if(!trimmed)return raw;
  if(map[trimmed])return raw.replace(trimmed,map[trimmed]);
  const keys=Object.keys(map).sort((a,b)=>b.length-a.length);
  let out=raw;
  for(const key of keys){
    if(key.length<3)continue;
    out=out.split(key).join(map[key]);
  }
  return out;
}
function applyLanguage(lang:Lang){
  if(typeof document==="undefined"||!document.body)return;
  document.documentElement.lang=lang;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(node){
    const parent=node.parentElement;
    if(!parent||parent.closest("script,style,textarea,select,.language-dock,[data-no-translate]"))return NodeFilter.FILTER_REJECT;
    return (node.textContent||"").trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
  }});
  const nodes:Text[]=[];
  while(walker.nextNode())nodes.push(walker.currentNode as Text);
  nodes.forEach(node=>{
    if(!originalText.has(node))originalText.set(node,node.textContent||"");
    const original=originalText.get(node)||"";
    const next=translateText(original,lang);
    if(node.textContent!==next)node.textContent=next;
  });
}

export function LanguageSelector(){
  const[lang,setLang]=useState<Lang>("en");
  const timer=useRef<number|null>(null);
  useEffect(()=>{
    const saved=(localStorage.getItem("damasio_lang") as Lang)||"en";
    setLang(saved);
    const schedule=()=>{if(timer.current)window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>applyLanguage((localStorage.getItem("damasio_lang") as Lang)||"en"),80)};
    schedule();
    const obs=new MutationObserver(schedule);
    obs.observe(document.body,{childList:true,subtree:true});
    window.addEventListener("damasio-language-change",schedule as EventListener);
    return()=>{obs.disconnect();window.removeEventListener("damasio-language-change",schedule as EventListener);if(timer.current)window.clearTimeout(timer.current)};
  },[]);
  function change(v:Lang){setLang(v);localStorage.setItem("damasio_lang",v);applyLanguage(v);window.dispatchEvent(new CustomEvent("damasio-language-change",{detail:{language:v}}))}
  return <div className="language-dock" aria-label="Language selector" data-no-translate="true"><label>{helper[lang]}</label><select value={lang} onChange={e=>change(e.target.value as Lang)}><option value="en">English</option><option value="pt">Português</option><option value="fr">Français</option><option value="es">Español</option></select><small>{languages[lang]}</small></div>
}
