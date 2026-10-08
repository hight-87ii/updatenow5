import { PublicLayout } from "@/components/layout/product-layout";
import { WaitingRoom } from "@/features/waiting-room/waiting-room";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PublicLayout>
      <WaitingRoom id={id} />
    </PublicLayout>
  );
}
