import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ChainProvider } from "./lib/chain.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ChainProvider>
        <App />
      </ChainProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
