import Editor from "@monaco-editor/react";
import { QueryResult } from "../lib/results";

type Props = {
  results: QueryResult;
};

const Results: React.FC<Props> = ({ results }) => {
  if (typeof results !== "string") {
    return <pre>{JSON.stringify(results, null, 2)}</pre>;
  } else {
    return <Editor height="50vh" value={results} theme="vs-dark" />;
  }
};

export default Results;
