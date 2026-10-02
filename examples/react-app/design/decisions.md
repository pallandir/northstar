# Decisions

## 2026-10-01 Direction for the plans page

- Placement: in-app page at /pricing inside the sidebar shell, mode operate.
- Structure: Starter, Team and Business with a monthly/annual switch, the current plan marked and a feature comparison table.
- Direction: fresh system, deep blue primary with Fira Sans and Fira Code, replacing the #0d99ff look on this page only.
- Components: Radix Primitives instead of shadcn/ui, because the app has no Tailwind.
- Rollout: Dashboard and User pages keep their styles until a later migration, so two visual systems share the shell for now.
