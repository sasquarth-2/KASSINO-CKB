import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kassino CKB - Fortune Tiger",
  description: "Um clone exclusivo do Fortune Tiger para jogar com amigos usando CKBucks fictícios. Sem dinheiro real, apenas diversão e competição!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
