import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@base-cafe/ui/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Base Cafe Kitchen",
  description: "Touch-first Base Cafe kitchen display",
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
