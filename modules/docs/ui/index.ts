import { defineModuleUi } from "@office/ui/module-ui";
import { DocumentPage } from "./DocumentPage.tsx";
import { Library, NewRequest, TemplatesPage, WaitingPage } from "./Library.tsx";
import { SignPage } from "./SignPage.tsx";
import { ContactDocsTab, DocsWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "docs",
  pages: {
    "/docs": Library,
    "/docs/new": NewRequest,
    "/docs/waiting": WaitingPage,
    "/docs/templates": TemplatesPage,
    "/docs/:id": DocumentPage,
  },
  publicPages: { "/sign/:token": SignPage },
  components: { DocsWidget, ContactDocsTab },
});
