import React from "react";
import { createRoot } from "react-dom/client";

import "./initial.css";

void import("./lazy/LazyPanel");

function App() {
  return (
    <main className="initial-shell">
      <div className="false-lazy-only">cssCodeSplit false CSS should be initial</div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
