import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/app/providers";
import { UserNav } from "@/components/auth/user-nav";
import { SwRegister } from "@/components/pwa/sw-register";
import { AppShell } from "@/components/shell/app-shell";
import { UiScale } from "@/components/shell/ui-scale";
import { auth } from "@/server/auth";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OwnTube",
  description: "Self-hosted video front-end with Piped / Invidious",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico?v=6", sizes: "any" },
      { url: "/logo.png?v=6", type: "image/png", sizes: "32x32" },
      { url: "/logo.png?v=6", type: "image/png", sizes: "192x192" },
    ],
    shortcut: [{ url: "/favicon.ico?v=6" }],
    apple: [{ url: "/logo.png?v=6", type: "image/png", sizes: "180x180" }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user?.id);

  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers>
          <UiScale />
          <SwRegister />
          <AppShell isLoggedIn={isLoggedIn} topbarRight={<UserNav />}>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
