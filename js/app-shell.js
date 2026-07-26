/**
 * Protected app shell — sidebar, topbar, auth gate
 */
import { requireAuth, logOut, onAuth } from "./auth.js";

export async function initProtectedPage({ activeNav = "sessions" } = {}) {
  const gate = document.getElementById("app-gate");
  const user = await requireAuth();

  const name =
    user.displayName ||
    user.email?.split("@")[0] ||
    "Operator";
  const email = user.email || "";

  document.querySelectorAll("[data-user-name]").forEach((el) => {
    el.textContent = name;
  });
  document.querySelectorAll("[data-user-email]").forEach((el) => {
    el.textContent = email;
  });
  document.querySelectorAll("[data-user-initial]").forEach((el) => {
    el.textContent = (name[0] || "A").toUpperCase();
  });

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-nav") === activeNav);
  });

  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await logOut();
      window.location.replace("/login.html");
    });
  });

  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (toggle && sidebar) {
    const close = () => {
      sidebar.classList.remove("open");
      backdrop?.classList.remove("show");
    };
    const open = () => {
      sidebar.classList.add("open");
      backdrop?.classList.add("show");
    };
    toggle.addEventListener("click", () => {
      if (sidebar.classList.contains("open")) close();
      else open();
    });
    backdrop?.addEventListener("click", close);
  }

  onAuth((u) => {
    if (!u) window.location.replace("/login.html");
  });

  if (gate) {
    gate.classList.add("hidden");
    setTimeout(() => gate.remove(), 400);
  }

  return user;
}
