import { AdministrationShell } from "./administration-shell";
import { CatalogShell } from "./catalog-shell";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { demo } = await searchParams;
  return demo === "1" ? <CatalogShell /> : <AdministrationShell />;
}
