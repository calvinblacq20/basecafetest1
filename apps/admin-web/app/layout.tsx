import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@base-cafe/ui/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Base Cafe Admin",
  description: "Protected Base Cafe administration interface",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
