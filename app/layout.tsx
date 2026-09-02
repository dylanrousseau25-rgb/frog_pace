import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Frog Pace",
  description: "Ton coach d'endurance personnel."
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body><AppShell>{props.children}</AppShell></body>
    </html>
  );
}
