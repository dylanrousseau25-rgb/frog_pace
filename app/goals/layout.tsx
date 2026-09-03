import Link from "next/link";

export default function GoalsLayout({ children }: { children: React.ReactNode }) {
  return <>
    {children}
    <div style={{ maxWidth: 760, margin: "0 auto 110px", padding: "0 16px" }}>
      <Link href="/goals/manage" className="frog-button frog-button-secondary frog-button-wide">Gérer / abandonner l’objectif principal</Link>
    </div>
  </>;
}
