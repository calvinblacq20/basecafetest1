import type { Metadata } from "next";

import { SecurityOperationsShell } from "./security-operations-shell";

export const metadata: Metadata = {
  title: "Security & audit · Base Cafe Admin",
  description:
    "Review security alerts, active sessions, audit history, and privacy key posture.",
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const preview =
    process.env.NODE_ENV !== "production" && (await searchParams).demo === "1";
  return <SecurityOperationsShell initialDemo={preview} />;
}
