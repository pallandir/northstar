import { Search } from "lucide-react";

export function Landing() {
  return (
    <main className="bg-neutral-950 text-neutral-50">
      <h1 className="text-5xl font-semibold tracking-tight">Reconcile invoices in minutes</h1>
      <p className="max-w-prose text-neutral-300">
        Match payments to invoices and see what is still open by customer.
      </p>
      <button type="button" className="rounded-md px-4 py-2 transition-colors focus-visible:ring-2">
        <Search aria-hidden />
        Save changes
      </button>
      <img src="/hero.png" alt="Open invoices grouped by customer" />
    </main>
  );
}
