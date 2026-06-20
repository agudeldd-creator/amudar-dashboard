import type { Metadata } from "next";
import { DM_Sans, Inter_Tight } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "A-mudar — Ads Dashboard",
  description: "Reporte en vivo de performance de Meta Ads + Google Ads para A-mudar",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${dmSans.variable} ${interTight.variable} antialiased`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
