import { redirect } from "next/navigation";

export default function SchedulePage() {
  redirect("/admin/routes?tab=build");
}
