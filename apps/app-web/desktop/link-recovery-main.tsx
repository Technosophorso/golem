import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopLinkRecovery } from "@/components/desktop-link-recovery";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ThemeProvider } from "@/lib/theme";
import "./app.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <I18nProvider locale="en" dict={getDictionary("en")}>
          <DesktopLinkRecovery />
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
