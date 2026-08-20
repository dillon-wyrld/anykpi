import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANYKPI — The growth stack for modern builders",
  description: "Dashboard + API + CLI + MCP. Connect your tools or add ANYKPI to your product.",
  icons: {
    icon: [
      { url: "/brand/icon.svg", type: "image/svg+xml" },
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon.ico", sizes: "48x48" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
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
