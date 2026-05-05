import React from "react";
import { createRoot } from "react-dom/client";

import "./initial.css";

void import("./lazy/LazyPanel");

function App() {
  return (
    <main className="initial-shell">
      <div className="default-lazy-only">default split CSS should be lazy</div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
