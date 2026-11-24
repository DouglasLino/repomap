import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import type { RepositoryProvider } from "../types/graph";

interface RepositoryFormProps {
  provider: RepositoryProvider;
  repoUrl: string;
  accessToken: string;
  maxCommits: number;
  loading: boolean;
  onProviderChange: (value: RepositoryProvider) => void;
  onRepoUrlChange: (value: string) => void;
  onAccessTokenChange: (value: string) => void;
  onMaxCommitsChange: (value: number) => void;
  onSubmit: () => void;
}

function maskedToken(token: string): string {
  if (token.length <= 3) {
    return token;
  }

  return `${token.slice(0, 3)}${"*".repeat(token.length - 3)}`;
}

export function RepositoryForm({
  provider,
  repoUrl,
  accessToken,
  maxCommits,
  loading,
  onProviderChange,
  onRepoUrlChange,
  onAccessTokenChange,
  onMaxCommitsChange,
  onSubmit
}: RepositoryFormProps) {
  const providerLabel = provider === "gitlab" ? "GitLab" : "GitHub";

  function replaceTokenRange(start: number, end: number, value: string) {
    onAccessTokenChange(`${accessToken.slice(0, start)}${value}${accessToken.slice(end)}`);
  }

  function tokenSelection(input: HTMLInputElement) {
    return {
      start: input.selectionStart ?? accessToken.length,
      end: input.selectionEnd ?? accessToken.length
    };
  }

  function handleTokenBeforeInput(event: FormEvent<HTMLInputElement>) {
    const inputEvent = event.nativeEvent as InputEvent;
    if (inputEvent.inputType !== "insertText" || !inputEvent.data) {
      return;
    }

    const { start, end } = tokenSelection(event.currentTarget);
    event.preventDefault();
    replaceTokenRange(start, end, inputEvent.data);
  }

  function handleTokenKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }

    const { start, end } = tokenSelection(event.currentTarget);
    event.preventDefault();

    if (start !== end) {
      replaceTokenRange(start, end, "");
      return;
    }

    if (event.key === "Backspace" && start > 0) {
      replaceTokenRange(start - 1, start, "");
      return;
    }

    if (event.key === "Delete" && start < accessToken.length) {
      replaceTokenRange(start, start + 1, "");
    }
  }

  function handleTokenPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pastedToken = event.clipboardData.getData("text");
    const { start, end } = tokenSelection(event.currentTarget);
    replaceTokenRange(start, end, pastedToken);
  }

  return (
    <form
      className="repo-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="repo-url-field">
        <div className="repo-provider-toggle" role="group" aria-label="Proveedor Git">
          <button
            type="button"
            className={`repo-provider-option${provider === "github" ? " repo-provider-option-active" : ""}`}
            onClick={() => onProviderChange("github")}
            aria-label="Usar GitHub"
            aria-pressed={provider === "github"}
            title="GitHub"
          >
            <i className="pi pi-github" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`repo-provider-option repo-provider-option-gitlab${provider === "gitlab" ? " repo-provider-option-active" : ""}`}
            onClick={() => onProviderChange("gitlab")}
            aria-label="Usar GitLab"
            aria-pressed={provider === "gitlab"}
            title="GitLab"
          >
            <span aria-hidden="true">GL</span>
          </button>
        </div>
        <InputText
          value={repoUrl}
          onChange={(event) => onRepoUrlChange(event.target.value)}
          placeholder={provider === "gitlab" ? "https://gitlab.com/group/project" : "https://github.com/DouglasLino/testDiagramView"}
          aria-label={`URL del repositorio ${providerLabel}`}
        />
      </div>

      <div className="provider-token-field">
        <label htmlFor="provider-token">Token</label>
        <InputText
          id="provider-token"
          value={maskedToken(accessToken)}
          onBeforeInput={handleTokenBeforeInput}
          onKeyDown={handleTokenKeyDown}
          onPaste={handleTokenPaste}
          onChange={(event) => {
            if (!event.target.value.includes("*")) {
              onAccessTokenChange(event.target.value);
            }
          }}
          placeholder="token..."
          aria-label={`Token de ${providerLabel}`}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="max-commits-field">
        <label htmlFor="max-commits">Máx. commits por rama</label>
        <InputNumber
          inputId="max-commits"
          value={maxCommits}
          onValueChange={(event) => onMaxCommitsChange(event.value ?? 3)}
          min={1}
          max={500}
          showButtons
        />
      </div>

      <Button type="submit" label="Graficar" icon="pi pi-sitemap" loading={loading} />
    </form>
  );
}
