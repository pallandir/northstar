import { Link, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage.jsx";
import { UserPage } from "./pages/UserPage.jsx";

const nav = [
  { label: "Dashboard", to: "/" },
  { label: "Jamie Lee", to: "/users/8123" },
];

export function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">◆ Northwind</div>
        <nav className="nav">
          {nav.map((item) => (
            <Link key={item.to} className="nav-link" to={item.to}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">JL</div>
          <div>
            <div className="user-name">Jamie Lee</div>
            <div className="user-role">Product owner</div>
          </div>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/users/:id" element={<UserPage />} />
        </Routes>
      </main>

      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f4f5f7; color: #1e1e1e; }
        a { text-decoration: none; color: inherit; }
        .app { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }

        .sidebar { display: flex; flex-direction: column; gap: 24px; padding: 24px 18px; background: #ffffff; border-right: 1px solid #e6e6e6; }
        .brand { font-size: 17px; font-weight: 700; color: #0d99ff; }
        .nav { display: flex; flex-direction: column; gap: 4px; }
        .nav-link { padding: 9px 12px; border-radius: 9px; font-size: 14px; color: #4b5563; }
        .nav-link:hover { background: #f4f5f7; }
        .sidebar-user { display: flex; align-items: center; gap: 10px; margin-top: auto; padding-top: 16px; border-top: 1px solid #e6e6e6; }
        .avatar { width: 36px; height: 36px; border-radius: 50%; background: #0d99ff; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; }
        .user-name { font-size: 13px; font-weight: 600; }
        .user-role { font-size: 12px; color: #8a8a8a; }

        .main { padding: 28px 32px; max-width: 1080px; }
        .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
        .title { font-size: 24px; margin: 0; }
        .subtitle { margin: 4px 0 0; color: #6b7280; font-size: 14px; }
        .topbar-actions { display: flex; gap: 10px; align-items: center; }
        .search { padding: 9px 12px; border: 1px solid #e6e6e6; border-radius: 9px; font-size: 14px; background: #fff; outline: none; }
        .search:focus { border-color: #0d99ff; box-shadow: 0 0 0 3px rgba(13,153,255,0.12); }
        .cta { padding: 9px 16px; border: 0; border-radius: 9px; background: #0d99ff; color: #fff; font-weight: 600; font-size: 14px; cursor: pointer; }
        .cta:hover { background: #0a85e0; }

        .card { background: #fff; border: 1px solid #e6e6e6; border-radius: 14px; padding: 20px; }
        .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .card-title { font-size: 15px; margin: 0; }
        .card-hint { font-size: 12px; color: #8a8a8a; }

        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
        .kpi { display: flex; flex-direction: column; gap: 6px; }
        .kpi-label { font-size: 13px; color: #6b7280; }
        .kpi-value { font-size: 26px; }
        .kpi-delta { font-size: 12px; font-weight: 600; }
        .kpi-delta--up { color: #14ae5c; }
        .kpi-delta--down { color: #e5484d; }

        .panels { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; margin-bottom: 16px; }
        .chart { position: relative; padding-left: 44px; }
        .chart-grid { position: absolute; inset: 8px 0 24px 44px; display: flex; flex-direction: column; justify-content: space-between; }
        .grid-line { position: relative; border-top: 1px solid #f0f0f0; }
        .grid-value { position: absolute; left: -44px; top: -8px; width: 38px; text-align: right; font-size: 11px; color: #b5b5b5; font-variant-numeric: tabular-nums; }
        .bars { position: relative; display: flex; align-items: flex-end; gap: 16px; height: 160px; padding-top: 8px; }
        .bar-col { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1; }
        .bar-value { font-size: 11px; font-weight: 600; color: #6b7280; font-variant-numeric: tabular-nums; }
        .bar { width: 100%; max-width: 40px; border-radius: 8px 8px 0 0; background: linear-gradient(#0d99ff, #6dc1ff); }
        .bar-label { font-size: 12px; color: #8a8a8a; }

        .source-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; vertical-align: middle; }
        .source-label { vertical-align: middle; }
        .source-pct { color: #6b7280; font-variant-numeric: tabular-nums; }

        .table-card { padding-bottom: 8px; }
        .link-btn { border: 0; background: none; color: #0d99ff; font-size: 13px; font-weight: 600; cursor: pointer; }
        .table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .table th { text-align: left; padding: 10px 8px; color: #8a8a8a; font-size: 12px; font-weight: 600; border-bottom: 1px solid #e6e6e6; }
        .table td { padding: 12px 8px; border-bottom: 1px solid #f0f0f0; }
        .table .num { text-align: right; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #4b5563; }
        .badge { padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
        .badge--paid { background: #e6f7ee; color: #14ae5c; }
        .badge--pending { background: #fff4e5; color: #b8730b; }
        .badge--refunded { background: #fdeaea; color: #e5484d; }
      `}</style>
    </div>
  );
}
