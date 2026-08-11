import { KitchenShell } from "./kitchen-shell";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const query = await searchParams;
  return <KitchenShell demo={query.demo === "1"} />;
}
