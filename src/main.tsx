import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as loader from "@monaco-editor/loader";
import * as monacoEditor from "monaco-editor";
import App from "./App";
import "./styles/globals.css";
import "./i18n/index";

// Переключаем Monaco с CDN на локальный пакет из node_modules.
// По умолчанию @monaco-editor/loader грузит Monaco с cdn.jsdelivr.net —
// в production Tauri .exe без интернета это вешает редактор навсегда.
loader.default.config({ monaco: monacoEditor });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
