import { PaymentSuccessClient } from "./PaymentSuccessClient";

export default function PaymentSuccessPage({
  searchParams,
}: {
  searchParams?: { session_id?: string };
}) {
  return <PaymentSuccessClient sessionId={String(searchParams?.session_id || "")} />;
}
