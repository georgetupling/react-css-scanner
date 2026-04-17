const isOpen = true;

export function DynamicPanel() {
  return <section className={`panel ${isOpen ? "open" : "panel"}`}>Panel</section>;
}
