import { defineAsyncComponent } from "vue";
import { createRouter, createWebHistory } from "vue-router";

export const APP_ROUTES = [
  { name: "kanban", path: "/" },
  { name: "wiki", path: "/wiki" },
  { name: "capture", path: "/capture" },
  { name: "config", path: "/config" },
  { name: "room", path: "/room/:itemId" },
] as const;

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      name: "kanban",
      path: "/",
      component: defineAsyncComponent(() => import("./pages/KanbanPage.vue")),
    },
    {
      name: "wiki",
      path: "/wiki",
      component: defineAsyncComponent(() => import("./pages/WikiPage.vue")),
    },
    {
      name: "capture",
      path: "/capture",
      component: defineAsyncComponent(() => import("./pages/CapturePage.vue")),
    },
    {
      name: "config",
      path: "/config",
      component: defineAsyncComponent(() => import("./pages/ConfigPage.vue")),
    },
    {
      name: "room",
      path: "/room/:itemId",
      component: defineAsyncComponent(() => import("./pages/RoomPage.vue")),
    },
  ],
});
