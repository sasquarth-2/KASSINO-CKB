import type { Metadata } from "next";
import "./globals.css";
import AntiCheat from "@/components/AntiCheat";

export const metadata: Metadata = {
  title: "Kassino CKB - Fortune Tiger",
  description: "Sem dinheiro real, apenas diversão e competição!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        <AntiCheat />
        {children}
      </body>
    </html>
  );
}
