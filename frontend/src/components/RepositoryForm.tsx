import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";

interface RepositoryFormProps {
  repoUrl: string;
  githubToken: string;
  maxCommits: number;
  loading: boolean;
  onRepoUrlChange: (value: string) => void;
  onGithubTokenChange: (value: string) => void;
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
  repoUrl,
  githubToken,
  maxCommits,
  loading,
  onRepoUrlChange,
  onGithubTokenChange,
  onMaxCommitsChange,
  onSubmit
}: RepositoryFormProps) {
  function replaceTokenRange(start: number, end: number, value: string) {
    onGithubTokenChange(`${githubToken.slice(0, start)}${value}${githubToken.slice(end)}`);
  }

  function tokenSelection(input: HTMLInputElement) {
    return {
      start: input.selectionStart ?? githubToken.length,
      end: input.selectionEnd ?? githubToken.length
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

    if (event.key === "Delete" && start < githubToken.length) {
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
        <i className="pi pi-github repo-url-icon" aria-hidden="true" />
        <InputText
          value={repoUrl}
          onChange={(event) => onRepoUrlChange(event.target.value)}
          placeholder="https://github.com/DouglasLino/testDiagramView"
          aria-label="URL del repositorio GitHub"
        />
      </div>

      <div className="github-token-field">
        <label htmlFor="github-token">Token</label>
        <InputText
          id="github-token"
          value={maskedToken(githubToken)}
          onBeforeInput={handleTokenBeforeInput}
          onKeyDown={handleTokenKeyDown}
          onPaste={handleTokenPaste}
          onChange={(event) => {
            if (!event.target.value.includes("*")) {
              onGithubTokenChange(event.target.value);
            }
          }}
          placeholder="token..."
          aria-label="Token de GitHub"
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
