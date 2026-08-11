import type { Metadata } from "next";

import { ReadinessShell } from "./readiness-shell";

export const metadata: Metadata = {
  title: "Pilot readiness · Base Cafe Admin",
  description:
    "Review automated launch gates, external evidence, and immutable readiness snapshots.",
};

export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const preview =
    process.env.NODE_ENV !== "production" && (await searchParams).demo === "1";
  return <ReadinessShell initialDemo={preview} />;
}
