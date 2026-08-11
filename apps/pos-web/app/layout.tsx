import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@base-cafe/ui/tokens.css";
import "./globals.css?stage2-cash-control";

export const metadata: Metadata = {
  title: "Base Cafe POS",
  description: "Touch-first Base Cafe point-of-sale interface",
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
