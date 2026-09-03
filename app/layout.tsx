import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "Frog Pace",
  description: "Ton coach d'endurance personnel.",
  manifest: "/manifest.webmanifest",
  applicationName: "Frog Pace",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Frog Pace"
  },
  icons: {
    icon: "/frog-icon.svg",
    apple: "/frog-icon.svg"
  }
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body><PwaRegister /><AppShell>{props.children}</AppShell></body>
    </html>
  );
}
