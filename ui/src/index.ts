import { definePlugin } from "@halo-dev/ui-shared";
import SyncPage from "./views/SyncPage.vue";

export default definePlugin({
  routes: [
    {
      parentName: "ToolsRoot",
      route: {
        path: "/openlist",
        name: "OpenListSync",
        component: SyncPage,
        meta: {
          title: "OpenList 同步",
          searchable: true,
          menu: {
            name: "OpenList 同步",
            priority: 0,
          },
        },
      },
    },
  ],
});
