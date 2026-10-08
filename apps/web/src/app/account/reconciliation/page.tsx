import { OrganizerLayout } from "@/components/layout/product-layout";
import { PaymentReconciliation } from "@/features/payment-reconciliation/payment-reconciliation";

export default function Page() {
  return (
    <OrganizerLayout title="Đối soát thanh toán" mode="account">
      <PaymentReconciliation />
    </OrganizerLayout>
  );
}
