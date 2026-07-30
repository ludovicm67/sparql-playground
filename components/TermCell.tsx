import { Fragment } from "react";
import { QueryResultBindingValue } from "../lib/results";

const KNOWN_PREFIXES: Record<string, string> = {
  "http://www.w3.org/2001/XMLSchema#": "xsd",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf",
  "http://www.w3.org/2000/01/rdf-schema#": "rdfs",
};

// Datatypes every literal carries implicitly — showing them would be noise.
const IMPLICIT_DATATYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#string",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
]);

/** Split an IRI into its namespace and its local name, for two-tone display. */
const splitIri = (iri: string) => {
  const boundary = Math.max(
    iri.lastIndexOf("#"),
    iri.lastIndexOf("/"),
    iri.lastIndexOf(":")
  );

  if (boundary < 0 || boundary === iri.length - 1) {
    return { namespace: "", local: iri };
  }

  return {
    namespace: iri.slice(0, boundary + 1),
    local: iri.slice(boundary + 1),
  };
};

/**
 * Offer the browser a break opportunity after every IRI separator, so a long
 * namespace wraps at a path boundary rather than in the middle of a segment.
 */
const withBreakPoints = (text: string) => {
  const segments: string[] = [];
  let current = "";

  for (const character of text) {
    current += character;
    if (character === "/" || character === "#" || character === ":") {
      segments.push(current);
      current = "";
    }
  }
  if (current) {
    segments.push(current);
  }

  return segments.map((segment, index) => (
    <Fragment key={index}>
      {segment}
      {index < segments.length - 1 ? <wbr /> : null}
    </Fragment>
  ));
};

const shortenDatatype = (iri: string) => {
  const { namespace, local } = splitIri(iri);
  const prefix = KNOWN_PREFIXES[namespace];

  return prefix ? `${prefix}:${local}` : local;
};

type Props = {
  term: QueryResultBindingValue;
};

/** Renders one solution binding, styled by term type. */
const TermCell: React.FC<Props> = ({ term }) => {
  if (term.type === "uri") {
    const { namespace, local } = splitIri(term.value);

    return (
      <span className="term term-uri" title={term.value}>
        <span className="term-ns">{withBreakPoints(namespace)}</span>
        <wbr />
        <span className="term-local">{local}</span>
      </span>
    );
  }

  if (term.type === "bnode") {
    // Oxigraph mints 32-char labels; enough of one to tell rows apart is plenty.
    const label =
      term.value.length > 12 ? `${term.value.slice(0, 10)}…` : term.value;

    return (
      <span className="term term-bnode" title={`Blank node _:${term.value}`}>
        _:{label}
      </span>
    );
  }

  const language = term["xml:lang"];
  const datatype = term.datatype;

  let note: string | undefined;
  if (language) {
    note = `@${language}`;
  } else if (datatype && !IMPLICIT_DATATYPES.has(datatype)) {
    note = `^^${shortenDatatype(datatype)}`;
  }

  return (
    <span className="term term-literal">
      {term.value}
      {note ? (
        <span className="term-note" title={datatype}>
          {note}
        </span>
      ) : null}
    </span>
  );
};

export default TermCell;
