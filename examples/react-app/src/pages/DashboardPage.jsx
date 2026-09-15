import { TrafficSources } from "../components/TrafficSources.jsx";

const kpis = [
  { id: "revenue", label: "Total revenue", value: "$48,200", delta: "+12.4%", up: true },
  { id: "users", label: "Active users", value: "1,284", delta: "+3.1%", up: true },
  { id: "churn", label: "Churn rate", value: "2.1%", delta: "-0.4%", up: true },
  { id: "convert", label: "Conversion", value: "4.7%", delta: "-1.2%", up: false },
];

const months = [
  { m: "Jan", v: 42 },
  { m: "Feb", v: 55 },
  { m: "Mar", v: 48 },
  { m: "Apr", v: 70 },
  { m: "May", v: 63 },
  { m: "Jun", v: 88 },
];

const gridLines = [100, 75, 50, 25, 0];

const orders = [
  { id: "#1042", customer: "Acme Corp", status: "Paid", amount: "$1,200" },
  { id: "#1041", customer: "Globex", status: "Pending", amount: "$840" },
  { id: "#1040", customer: "Initech", status: "Paid", amount: "$2,150" },
  { id: "#1039", customer: "Umbrella", status: "Refunded", amount: "$320" },
];

export function DashboardPage() {
  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="title">Overview</h1>
          <p className="subtitle">Welcome back, here is how things look today.</p>
        </div>
        <div className="topbar-actions">
          <input className="search" placeholder="Search…" />
          <button className="cta" type="button">
            New report
          </button>
        </div>
      </header>

      <section className="kpis">
        {kpis.map((kpi) => (
          <article key={kpi.id} className="card kpi">
            <span className="kpi-label">{kpi.label}</span>
            <strong className="kpi-value">{kpi.value}</strong>
            <span className={`kpi-delta${kpi.up ? " kpi-delta--up" : " kpi-delta--down"}`}>
              {kpi.delta}
            </span>
          </article>
        ))}
      </section>

      <section className="panels">
        <article className="card chart-card">
          <div className="card-head">
            <h2 className="card-title">Revenue by month</h2>
            <span className="card-hint">Last 6 months</span>
          </div>
          <div className="chart">
            <div className="chart-grid">
              {gridLines.map((line) => (
                <div key={line} className="grid-line">
                  <span className="grid-value">${line}k</span>
                </div>
              ))}
            </div>
            <div className="bars">
              {months.map((month) => (
                <div key={month.m} className="bar-col">
                  <span className="bar-value">${month.v}k</span>
                  <div className="bar" style={{ height: `${(month.v / 100) * 140}px` }} />
                  <span className="bar-label">{month.m}</span>
                </div>
              ))}
            </div>
          </div>
        </article>

        <TrafficSources />
      </section>

      <section className="card table-card">
        <div className="card-head">
          <h2 className="card-title">Recent orders</h2>
          <button className="link-btn" type="button">
            View all
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="mono">{order.id}</td>
                <td>{order.customer}</td>
                <td>
                  <span className={`badge badge--${order.status.toLowerCase()}`}>
                    {order.status}
                  </span>
                </td>
                <td className="num">{order.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
