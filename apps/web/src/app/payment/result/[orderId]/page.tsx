import { PaymentResult } from "@/features/payment-result/payment-result";

export default async function PaymentResultByPathPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <PaymentResult orderId={orderId} />;
}
