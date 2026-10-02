import { Globe } from "lucide-react";

const sources = [
  { id: "direct", label: "Direct", pct: 38, color: "#8839ef" },
  { id: "organic", label: "Organic search", pct: 27, color: "#40a02b" },
  { id: "social", label: "Social", pct: 21, color: "#fe640b" },
  { id: "referral", label: "Referral", pct: 14, color: "#1e66f5" },
];

// Nested one level inside DashboardPage, so a click here exercises a real component stack
// (TrafficSources < DashboardPage) rather than a single flat component.
export function TrafficSources() {
  return (
    <article className="card sources-card">
      <div className="card-head">
        <h2 className="card-title">
          <Globe className="card-icon" size={16} aria-hidden="true" />
          Traffic sources
        </h2>
      </div>
      <table className="table sources-table">
        <thead>
          <tr>
            <th>Source</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.id}>
              <td>
                <span className="source-dot" style={{ background: source.color }} />
                <span className="source-label">{source.label}</span>
              </td>
              <td className="num source-pct">{source.pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
