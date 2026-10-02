import {
  type AgentInfo,
  type SystemInfo,
  TEMPLATE_IDS,
  TEMPLATE_LABELS,
  type TemplateId,
  type UserConfig,
  templateSchema,
} from "@northstar/protocol";
import { UserError } from "../lib/errors.js";
import { closeHelper, request } from "../lib/native.js";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The options page is missing #${id}.`);
  return found as T;
}

const helper = element<HTMLParagraphElement>("helper");
const agent = element<HTMLSelectElement>("agent");
const template = element<HTMLSelectElement>("template");
const projects = element<HTMLUListElement>("projects");
const form = element<HTMLFormElement>("add");
const message = element<HTMLParagraphElement>("message");

function show(text: string, error: boolean): void {
  message.textContent = text;
  message.classList.toggle("error", error);
  message.hidden = text === "";
}

function fail(err: unknown): void {
  if (err instanceof UserError) {
    show(`${err.message} ${err.fix}`, true);
    return;
  }
  console.error("[northstar]", err);
  show("Something went wrong inside Northstar. Details are in the extension console.", true);
}

function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function renderConfig(config: UserConfig, agents: AgentInfo[]): void {
  agent.replaceChildren(
    option("", "No preference"),
    ...agents.map((a) => option(a.id, a.installed ? a.name : `${a.name} (not installed)`)),
  );
  agent.value = config.preferredAgent ?? "";
  template.replaceChildren(...TEMPLATE_IDS.map((id) => option(id, TEMPLATE_LABELS[id])));
  template.value = config.template;
  projects.replaceChildren(
    ...Object.entries(config.projects).map(([key, directory]) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = `${key} to ${directory}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        const next = { ...config.projects };
        delete next[key];
        void save({ projects: next });
      });
      item.append(text, remove);
      return item;
    }),
  );
}

async function load(): Promise<void> {
  const info = await request<SystemInfo>("system.info");
  helper.textContent = `The Northstar helper is running, version ${info.version}.`;
  helper.classList.remove("error");
  const [config, agents] = await Promise.all([
    request<UserConfig>("config.get"),
    request<AgentInfo[]>("agent.list"),
  ]);
  renderConfig(config, agents);
}

async function save(change: Record<string, unknown>): Promise<void> {
  show("", false);
  try {
    await request("config.set", change);
    await load();
    show("Saved.", false);
  } catch (err) {
    fail(err);
  }
}

agent.addEventListener("change", () => void save({ preferredAgent: agent.value || null }));
template.addEventListener("change", () => {
  const chosen: TemplateId = templateSchema.parse(template.value);
  void save({ template: chosen });
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const key = String(data.get("key") ?? "").trim();
  const directory = String(data.get("directory") ?? "").trim();
  void (async () => {
    try {
      const config = await request<UserConfig>("config.get");
      await save({ projects: { ...config.projects, [key]: directory } });
      form.reset();
    } catch (err) {
      fail(err);
    }
  })();
});
window.addEventListener("pagehide", closeHelper);

load().catch((err: unknown) => {
  helper.classList.add("error");
  helper.textContent =
    err instanceof UserError ? `${err.message} ${err.fix}` : "The Northstar helper did not answer.";
  console.error("[northstar]", err);
});
