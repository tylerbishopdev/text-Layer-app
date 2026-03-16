import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Default to dark mode for karaoke vibes
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
if (prefersDark || !document.documentElement.classList.contains("light")) {
  document.documentElement.classList.add("dark");
}

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
