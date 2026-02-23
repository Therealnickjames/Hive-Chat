import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HiveChat",
  description: "AI-native self-hostable chat platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
