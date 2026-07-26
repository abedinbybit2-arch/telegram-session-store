import { waitForAuth } from "./auth.js";

const user = await waitForAuth();
const cta = document.getElementById("cta-primary");
if (cta && user) {
  cta.setAttribute("href", "/sessions.html");
  cta.textContent = "Open Session Vault";
}
