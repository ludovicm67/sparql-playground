import Editor from "@monaco-editor/react";
import { QueryResult } from "../lib/results";

type Props = {
  results: QueryResult;
};

const Results: React.FC<Props> = ({ results }) => {
  if (typeof results === "string") {
    return (
      <Editor
        height="40vh"
        value={results}
        theme="vs-dark"
        options={{
          scrollBeyondLastLine: false,
          readOnly: true,
          fontSize: 16,
        }}
      />
    );
  }

  if (Object.hasOwnProperty.call(results, "boolean")) {
    return <p>{results.boolean ? "True" : "False"}</p>;
  }

  const headVars = results.head.vars ?? [];
  const resultsItems = results.results ? results.results.bindings ?? [] : [];

  const tableHeadersItems = headVars.map((v) => <th key={v}>{v}</th>);
  const tableHeaders = <tr>{tableHeadersItems}</tr>;
  const tableHead = <thead>{tableHeaders}</thead>;
  const tableBodyItems = resultsItems.map((binding, i) => {
    const rowItems = headVars.map((v) => {
      const value = binding[v];
      return <td key={`${v}-${i}`}>{value?.value}</td>;
    });

    return <tr key={i}>{rowItems}</tr>;
  });

  const tableBody = <tbody>{tableBodyItems}</tbody>;
  const table = (
    <table>
      {tableHead}
      {tableBody}
    </table>
  );

  return table;
};

export default Results;
