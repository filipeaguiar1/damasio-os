export type FieldSyncStatus = "online" | "offline-ready" | "needs-sync";

export type FieldModeCard = {
  title: string;
  description: string;
  status: FieldSyncStatus;
  action: string;
};

export const fieldModeCards: FieldModeCard[] = [
  {
    title: "Employee Route",
    description: "Mobile-first route screen for employees with Start, Finish, comments and visit status in one place.",
    status: "online",
    action: "Open Route",
  },
  {
    title: "Offline Queue",
    description: "Prepared structure for saving Start, Finish, photos and comments locally when the phone has no signal.",
    status: "offline-ready",
    action: "Review Queue",
  },
  {
    title: "Photo Proof",
    description: "Photos stay attached to the exact property visit, not to a duplicated task or visual-only record.",
    status: "online",
    action: "Open Service Screen",
  },
  {
    title: "Sync Guard",
    description: "Future mobile actions must sync through the same Customer → Property → Job → Route → Visit lifecycle.",
    status: "needs-sync",
    action: "Check Sync Rules",
  },
];

export function getFieldModeSummary() {
  const total = fieldModeCards.length;
  const offlineReady = fieldModeCards.filter((card) => card.status === "offline-ready").length;
  const needsSync = fieldModeCards.filter((card) => card.status === "needs-sync").length;
  return { total, offlineReady, needsSync };
}
