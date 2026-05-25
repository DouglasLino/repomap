import { Button } from "primereact/button";

interface UtilityMenuProps {
  verticalLayout: boolean;
  commitsExpanded: boolean;
  onToggleLayout: () => void;
  onToggleCommits: () => void;
}

const utilityItems = [
  { icon: "pi pi-search-plus", label: "Zoom" },
  { icon: "pi pi-sliders-h", label: "Ajustes" },
  { icon: "pi pi-download", label: "Exportar" }
];

export function UtilityMenu({
  verticalLayout,
  commitsExpanded,
  onToggleLayout,
  onToggleCommits
}: UtilityMenuProps) {
  return (
    <nav className="utility-menu" aria-label="Herramientas del grafo">
      <Button
        type="button"
        icon="pi pi-sync"
        className={`utility-button${verticalLayout ? " utility-button-active" : ""}`}
        rounded
        text
        aria-label={verticalLayout ? "Mostrar grafo horizontal" : "Mostrar grafo vertical"}
        title={verticalLayout ? "Mostrar grafo horizontal" : "Mostrar grafo vertical"}
        onClick={onToggleLayout}
      />
      <Button
        type="button"
        icon={commitsExpanded ? "pi pi-eye-slash" : "pi pi-eye"}
        className={`utility-button${commitsExpanded ? " utility-button-active" : ""}`}
        rounded
        text
        aria-label={commitsExpanded ? "Ocultar todos los commits" : "Mostrar todos los commits"}
        title={commitsExpanded ? "Ocultar todos los commits" : "Mostrar todos los commits"}
        onClick={onToggleCommits}
      />
      {utilityItems.map((item) => (
        <Button
          key={item.label}
          type="button"
          icon={item.icon}
          className="utility-button"
          rounded
          text
          aria-label={item.label}
          title={item.label}
        />
      ))}
    </nav>
  );
}
