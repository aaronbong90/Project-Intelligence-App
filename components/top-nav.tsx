import Link from "next/link";

export function TopNav() {
  return (
    <header className="top-nav">
      <div>
        <p className="eyebrow">Field Intelligence</p>
        <h1>Project Field Hub Pro</h1>
      </div>
      <nav className="top-nav-links">
        <Link href="/">Home</Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/admin">Admin</Link>
        <Link href="/auth">Login</Link>
      </nav>
    </header>
  );
}
