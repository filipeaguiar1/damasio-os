import { CancelCheckoutClient } from "./CancelCheckoutClient";

export default function PaymentCancelPage({
  searchParams
}: {
  searchParams: { invoiceId?: string };
}) {
  return <CancelCheckoutClient invoiceId={searchParams.invoiceId || ""} />;
}
