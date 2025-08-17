import { Provider as ComponentProvider } from "@/components/ui/provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider as ReactProvider } from "react-redux";
import App from "./App.tsx";
import "./index.css";
import { store } from "./store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ComponentProvider>
      <ReactProvider store={store}>
        <App />
      </ReactProvider>
    </ComponentProvider>
  </StrictMode>,
);
