import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANYKPI — The growth stack for modern builders",
  description: "Dashboard + API + CLI + MCP. Connect your tools or add ANYKPI to your product.",
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
