import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { i18nReady } from "./i18n";
import "../globals.css";
import "./medialyze.css";
import { App } from "./App";

void i18nReady.then(() => ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
));

