import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { DataProvider } from "@/lib/store/DataProvider";
import { SessionProvider } from "@/lib/auth/SessionProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { AppShell } from "@/components/layout/AppShell";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "TRUST AI",
    template: "%s — TRUST AI",
  },
  description:
    "Prototype interne Trust Industrie : commandes, fournisseurs, logistique et encaissements. Mode démonstration, données fictives.",
  // Prototype sans authentification : on bloque toute indexation.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} font-sans antialiased`}>
        <SessionProvider>
          <DataProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
            </ToastProvider>
          </DataProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
