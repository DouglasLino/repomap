import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { InputText } from "primereact/inputtext";

interface BranchSelectorProps {
  branches: string[];
  selectedBranches: string[];
  branchColor: (branch: string) => string;
  onSelectionChange: (branches: string[]) => void;
}

export function BranchSelector({
  branches,
  selectedBranches,
  branchColor,
  onSelectionChange
}: BranchSelectorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setVisible(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const filteredBranches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return branches.filter((branch) => branch.toLowerCase().includes(term));
  }, [branches, search]);

  function toggleBranch(branch: string) {
    const isSelected = selectedBranches.includes(branch);
    if (isSelected && selectedBranches.length === 1) {
      return;
    }
    onSelectionChange(
      isSelected
        ? selectedBranches.filter((current) => current !== branch)
        : [...selectedBranches, branch]
    );
  }

  return (
    <div className="branch-selector" ref={containerRef}>
      <Button
        type="button"
        text
        className="branch-trigger"
        icon="pi pi-eye"
        label={`Ramas visibles: ${selectedBranches.length}/${branches.length}`}
        onClick={() => setVisible((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={visible}
      />

      {visible ? (
        <section className="branch-menu" aria-label="Seleccionar ramas visibles">
          <div className="branch-menu-header">
            <strong>Branches visibles</strong>
            <Button
              type="button"
              text
              rounded
              icon="pi pi-times"
              aria-label="Cerrar selector de ramas"
              onClick={() => setVisible(false)}
            />
          </div>

          <div className="branch-search">
            <i className="pi pi-search branch-search-icon" aria-hidden="true" />
            <InputText
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar una rama..."
              aria-label="Buscar una rama"
            />
          </div>

          <div className="branch-tab">Branches</div>
          <div className="branch-options">
            {filteredBranches.map((branch) => {
              const checked = selectedBranches.includes(branch);
              return (
                <label className="branch-option" key={branch}>
                  <Checkbox
                    inputId={`branch-option-${branch}`}
                    checked={checked}
                    onChange={() => toggleBranch(branch)}
                  />
                  <i style={{ backgroundColor: branchColor(branch) }} />
                  <span>{branch}</span>
                </label>
              );
            })}
            {filteredBranches.length === 0 ? (
              <p className="branch-empty">No se encontraron ramas.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
