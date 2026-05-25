import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";

interface RepositoryFormProps {
  repoUrl: string;
  maxCommits: number;
  loading: boolean;
  onRepoUrlChange: (value: string) => void;
  onMaxCommitsChange: (value: number) => void;
  onSubmit: () => void;
}

export function RepositoryForm({
  repoUrl,
  maxCommits,
  loading,
  onRepoUrlChange,
  onMaxCommitsChange,
  onSubmit
}: RepositoryFormProps) {
  return (
    <form
      className="repo-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="repo-url-field">
        <i className="pi pi-github repo-url-icon" aria-hidden="true" />
        <InputText
          value={repoUrl}
          onChange={(event) => onRepoUrlChange(event.target.value)}
          placeholder="https://github.com/DouglasLino/testDiagramView"
          aria-label="URL del repositorio GitHub"
        />
      </div>

      <InputNumber
        value={maxCommits}
        onValueChange={(event) => onMaxCommitsChange(event.value ?? 5)}
        min={1}
        max={500}
        showButtons
        aria-label="Cantidad maxima de commits por rama"
      />

      <Button type="submit" label="Graficar" icon="pi pi-sitemap" loading={loading} />
    </form>
  );
}
