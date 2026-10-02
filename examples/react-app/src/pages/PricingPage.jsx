import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check, Info, Minus } from "lucide-react";
import { Fragment, useState } from "react";
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/600.css";
import "@fontsource-variable/fira-code";
import "../styles/tokens.css";
import "./pricing.css";

const CURRENT_PLAN = "starter";
const RENEWAL = "1 November 2026";
const ANNUAL_DISCOUNT = 0.2;

const plans = [
  {
    id: "starter",
    name: "Starter",
    purpose: "For one team getting its numbers in one place.",
    monthly: 10,
    highlights: ["Up to 5 seats", "3 dashboards", "30 days of history", "Email support"],
  },
  {
    id: "team",
    name: "Team",
    purpose: "For growing teams that report to others.",
    monthly: 25,
    recommended: true,
    highlights: [
      "Up to 25 seats",
      "Unlimited dashboards",
      "2 years of history",
      "Scheduled reports",
    ],
  },
  {
    id: "business",
    name: "Business",
    purpose: "For companies with security and audit needs.",
    monthly: 50,
    highlights: ["Unlimited seats", "Unlimited dashboards", "Full history", "SSO and audit log"],
  },
];

const groups = [
  {
    name: "Usage",
    rows: [
      { label: "Seats", values: ["5", "25", "Unlimited"] },
      { label: "Dashboards", values: ["3", "Unlimited", "Unlimited"] },
      { label: "History", values: ["30 days", "2 years", "Full"] },
    ],
  },
  {
    name: "Collaboration",
    rows: [
      { label: "Shared reports", values: [true, true, true] },
      { label: "Scheduled reports", values: [false, true, true] },
      { label: "Comments", values: [false, true, true] },
    ],
  },
  {
    name: "Security",
    rows: [
      {
        label: "SSO",
        hint: "Sign in through your identity provider.",
        values: [false, false, true],
      },
      {
        label: "Audit log",
        hint: "A record of who changed what and when.",
        values: [false, false, true],
      },
    ],
  },
  {
    name: "Support",
    rows: [
      { label: "Email support", values: [true, true, true] },
      { label: "Priority response", values: [false, true, true] },
      { label: "Dedicated manager", values: [false, false, true] },
    ],
  },
];

const billingOptions = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: `Annual, save ${ANNUAL_DISCOUNT * 100}%` },
];

function priceFor(plan, billing) {
  return billing === "annual" ? plan.monthly * (1 - ANNUAL_DISCOUNT) : plan.monthly;
}

function actionFor(index, currentIndex) {
  if (index === currentIndex) return { label: "Current plan", variant: "current" };
  if (index > currentIndex) return { label: "Upgrade", variant: "primary" };
  return { label: "Downgrade", variant: "secondary" };
}

function Cell({ value }) {
  if (value === true) {
    return (
      <>
        <Check aria-hidden="true" size={16} strokeWidth={1.75} className="pricing-yes" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus aria-hidden="true" size={16} strokeWidth={1.75} className="pricing-no" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="pricing-value">{value}</span>;
}

function RowLabel({ label, hint }) {
  if (!hint) return label;
  return (
    <span className="pricing-term">
      {label}
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" className="pricing-info" aria-label={`What is ${label}?`}>
            <Info aria-hidden="true" size={16} strokeWidth={1.75} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="pricing-tooltip" sideOffset={6}>
            {hint}
            <Tooltip.Arrow className="pricing-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </span>
  );
}

export function PricingPage() {
  const [billing, setBilling] = useState("monthly");
  const currentIndex = plans.findIndex((plan) => plan.id === CURRENT_PLAN);
  const current = plans[currentIndex];

  return (
    <Tooltip.Provider delayDuration={150}>
      <div className="pricing">
        <header className="pricing-head">
          <div>
            <h1 className="pricing-title">Plans</h1>
            <p className="pricing-subtitle">
              You are on {current.name}. Renews {RENEWAL}.
            </p>
          </div>
          <ToggleGroup.Root
            type="single"
            value={billing}
            onValueChange={(value) => value && setBilling(value)}
            className="pricing-switch"
            aria-label="Billing period"
          >
            {billingOptions.map((option) => (
              <ToggleGroup.Item
                key={option.value}
                value={option.value}
                className="pricing-switch-item"
              >
                {option.label}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </header>

        <p className="sr-only" aria-live="polite">
          Showing {billing} prices
        </p>

        <div className="pricing-plans">
          {plans.map((plan, index) => {
            const action = actionFor(index, currentIndex);
            return (
              <section key={plan.id} className="pricing-plan" aria-labelledby={`plan-${plan.id}`}>
                <div className="pricing-plan-head">
                  <h2 id={`plan-${plan.id}`} className="pricing-plan-name">
                    {plan.name}
                  </h2>
                  {plan.recommended && <span className="pricing-badge">Recommended</span>}
                </div>
                <p className="pricing-plan-purpose">{plan.purpose}</p>
                <p className="pricing-price">
                  <span className="pricing-amount">${priceFor(plan, billing)}</span>
                  <span className="pricing-unit">per seat, per month</span>
                </p>
                <ul className="pricing-highlights">
                  {plan.highlights.map((item) => (
                    <li key={item}>
                      <Check
                        aria-hidden="true"
                        size={16}
                        strokeWidth={1.75}
                        className="pricing-yes"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`pricing-button pricing-button--${action.variant}`}
                  disabled={action.variant === "current"}
                >
                  {action.label}
                </button>
              </section>
            );
          })}
        </div>

        <section className="pricing-table-wrap" aria-label="Plan comparison">
          <table className="pricing-table">
            <caption className="sr-only">Feature comparison across plans</caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {plans.map((plan) => (
                  <th key={plan.id} scope="col">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.name}>
                  <tr className="pricing-group">
                    <th scope="colgroup" colSpan={plans.length + 1}>
                      {group.name}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">
                        <RowLabel label={row.label} hint={row.hint} />
                      </th>
                      {row.values.map((value, index) => (
                        <td key={plans[index].id}>
                          <Cell value={value} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>

        <p className="pricing-footnote">Billing questions? Write to billing@northwind.example.</p>
      </div>
    </Tooltip.Provider>
  );
}
