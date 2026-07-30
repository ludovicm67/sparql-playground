import Editor from "@monaco-editor/react";
import { QueryResult } from "../lib/results";
import { defineEditorTheme, EDITOR_THEME } from "../lib/monaco";
import TermCell from "./TermCell";

type Props = {
  results: QueryResult;
  onOpenResource?: (iri: string) => void;
};

const EmptyResult = () => (
  <div className="state">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="m16.5 16.5 4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
    <p className="state-title">No matches</p>
    <p className="state-hint">
      The query is valid, but nothing in the store satisfies it.
    </p>
  </div>
);

const Results: React.FC<Props> = ({ results, onOpenResource }) => {
  // CONSTRUCT / DESCRIBE hand back a serialized graph rather than bindings.
  if (typeof results === "string") {
    return (
      <Editor
        height="100%"
        value={results}
        theme={EDITOR_THEME}
        beforeMount={defineEditorTheme}
        options={{
          scrollBeyondLastLine: false,
          readOnly: true,
          domReadOnly: true,
          fontSize: 12.5,
          lineHeight: 21,
          padding: { top: 12, bottom: 12 },
          minimap: { enabled: false },
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          automaticLayout: true,
          wordWrap: "on",
          lineNumbersMinChars: 3,
        }}
      />
    );
  }

  if (Object.hasOwnProperty.call(results, "boolean")) {
    const value = Boolean(results.boolean);

    return (
      <div className="boolean-result">
        <span className="boolean-value" data-value={String(value)}>
          {value ? "true" : "false"}
        </span>
        <span className="boolean-caption">
          {value
            ? "The pattern matches at least once."
            : "Nothing in the store matches the pattern."}
        </span>
      </div>
    );
  }

  const headVars = results.head.vars ?? [];
  const bindings = results.results?.bindings ?? [];

  if (bindings.length === 0) {
    return <EmptyResult />;
  }

  return (
    <table className="results-table">
      <thead>
        <tr>
          <th className="col-index" scope="col">
            <span aria-hidden="true">#</span>
          </th>
          {headVars.map((variable) => (
            <th key={variable} scope="col">
              {variable}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bindings.map((binding, row) => (
          <tr key={row}>
            <td className="col-index">{row + 1}</td>
            {headVars.map((variable) => {
              const term = binding[variable];

              return (
                <td
                  key={variable}
                  className={term ? undefined : "is-unbound"}
                  title={term ? undefined : "Unbound"}
                >
                  {term ? (
                    <TermCell term={term} onOpenResource={onOpenResource} />
                  ) : (
                    "—"
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default Results;
