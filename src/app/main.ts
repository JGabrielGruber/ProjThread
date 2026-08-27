import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.ts";
import "../styles/tokens.css";
import "./styles.css";

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const local = location.hostname === "localhost";
  if (location.protocol !== "https:" && !local) return;
  void navigator.serviceWorker.register("/sw.js");
}

registerServiceWorker();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
