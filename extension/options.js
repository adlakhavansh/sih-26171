
import { VAULT_KEYS } from "./src/lib/vault.js";

const LABELS = {
  name: "Full name",
  aadhaar: "Aadhaar number",
  pan: "PAN",
  phone: "Mobile number",
  email: "Email"
};

const form = document.getElementById("vault");
const status = document.getElementById("status");

for (const key of VAULT_KEYS) {
  const label = document.createElement("label");
  label.textContent = LABELS[key];
  label.htmlFor = key;
  const input = document.createElement("input");
  input.id = key;
  input.name = key;
  input.autocomplete = "off";
  form.append(label, input);
}

const { vault = {} } = await chrome.storage.local.get("vault");
for (const key of VAULT_KEYS) {
  document.getElementById(key).value = vault[key] || "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const next = {};
  for (const key of VAULT_KEYS) next[key] = document.getElementById(key).value.trim();
  await chrome.storage.local.set({ vault: next });
  status.textContent = "Saved.";
  setTimeout(() => { status.textContent = ""; }, 2000);
});
