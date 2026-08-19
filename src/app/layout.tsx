import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANYKPI — every user, every number, every agent",
  description: "The growth dashboard a founder actually opens every morning",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
