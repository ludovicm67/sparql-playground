export type Example = {
  id: string;
  label: string;
  description: string;
  query: string;
};

// Ready-made queries against the bundled dataset, meant to show off a
// different SPARQL feature (and a different result shape) each.
export const examples: Example[] = [
  {
    id: "all",
    label: "All triples",
    description: "Every statement in the store",
    query: `# Some common prefixes
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

# Get the first 20 triples
SELECT * WHERE {
  ?subject ?predicate ?object .
}
LIMIT 20
`,
  },
  {
    id: "people",
    label: "People",
    description: "Everyone in the store, with their job",
    query: `PREFIX schema: <http://schema.org/>

# OPTIONAL keeps people who are missing a name or a job
SELECT ?given ?family ?job WHERE {
  ?person a schema:Person ;
          schema:givenName ?given .
  OPTIONAL { ?person schema:familyName ?family }
  OPTIONAL { ?person schema:jobTitle ?job }
}
ORDER BY ?given
`,
  },
  {
    id: "addresses",
    label: "Addresses",
    description: "Walk through the blank nodes holding each address",
    query: `PREFIX schema: <http://schema.org/>

# Addresses are attached through a blank node
SELECT ?given ?street ?city ?zip WHERE {
  ?person schema:givenName ?given ;
          schema:address ?address .

  ?address schema:streetAddress ?street ;
           schema:addressLocality ?city ;
           schema:postalCode ?zip .
}
ORDER BY ?street
`,
  },
  {
    id: "roommates",
    label: "Roommates",
    description: "Self-join to find people sharing a street address",
    query: `PREFIX schema: <http://schema.org/>

# "/" is a property path: hop over the address blank node
SELECT ?one ?other ?street WHERE {
  ?a schema:givenName ?one ;
     schema:address/schema:streetAddress ?street .

  ?b schema:givenName ?other ;
     schema:address/schema:streetAddress ?street .

  # keep one row per pair instead of two
  FILTER (STR(?one) < STR(?other))
}
`,
  },
  {
    id: "family",
    label: "Family",
    description: "Follow the parent / children relations",
    query: `PREFIX schema: <http://schema.org/>

SELECT ?child ?parent WHERE {
  ?c schema:parent ?p .

  ?c schema:givenName ?child .
  ?p schema:givenName ?parent .
}
`,
  },
  {
    id: "by-city",
    label: "Group by city",
    description: "Aggregate with GROUP BY and COUNT",
    query: `PREFIX schema: <http://schema.org/>

SELECT ?city (COUNT(?person) AS ?people) WHERE {
  ?person schema:address/schema:addressLocality ?city .
}
GROUP BY ?city
ORDER BY DESC(?people)
`,
  },
  {
    id: "vocabulary",
    label: "Vocabulary",
    description: "Which predicates does this dataset actually use?",
    query: `SELECT ?predicate (COUNT(*) AS ?uses) WHERE {
  ?s ?predicate ?o .
}
GROUP BY ?predicate
ORDER BY DESC(?uses) ?predicate
`,
  },
  {
    id: "ask",
    label: "ASK",
    description: "A yes / no question instead of a table",
    query: `PREFIX schema: <http://schema.org/>

# ASK returns a single boolean
ASK {
  ?person schema:jobTitle ?job .
  FILTER (CONTAINS(?job, "physicist"))
}
`,
  },
  {
    id: "construct",
    label: "CONSTRUCT",
    description: "Reshape the data into a new graph",
    query: `PREFIX schema: <http://schema.org/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

# CONSTRUCT returns triples, not bindings
CONSTRUCT {
  ?person a foaf:Person ;
          foaf:name ?name .
}
WHERE {
  ?person a schema:Person ;
          schema:givenName ?given .

  OPTIONAL { ?person schema:familyName ?family }
  BIND (CONCAT(?given, COALESCE(CONCAT(" ", ?family), "")) AS ?name)
}
`,
  },
];

/**
 * The queries above only make sense against the bundled dataset. Remote
 * endpoints get dataset-agnostic starting points instead, all of them bounded
 * so they stay cheap on a public server.
 */
export const remoteExamples: Example[] = [
  {
    id: "remote-sample",
    label: "Sample triples",
    description: "A handful of statements, whatever the dataset holds",
    query: `SELECT * WHERE {
  ?subject ?predicate ?object .
}
LIMIT 20
`,
  },
  {
    id: "remote-classes",
    label: "Classes",
    description: "The most used classes in the dataset",
    query: `SELECT ?class (COUNT(*) AS ?instances) WHERE {
  ?s a ?class .
}
GROUP BY ?class
ORDER BY DESC(?instances)
LIMIT 25
`,
  },
  {
    id: "remote-predicates",
    label: "Predicates",
    description: "The most used predicates in the dataset",
    query: `SELECT ?predicate (COUNT(*) AS ?uses) WHERE {
  ?s ?predicate ?o .
}
GROUP BY ?predicate
ORDER BY DESC(?uses)
LIMIT 25
`,
  },
  {
    id: "remote-graphs",
    label: "Named graphs",
    description: "Which named graphs the endpoint exposes",
    query: `SELECT DISTINCT ?graph WHERE {
  GRAPH ?graph { ?s ?p ?o }
}
LIMIT 25
`,
  },
  {
    id: "remote-ask",
    label: "ASK",
    description: "Cheapest possible check that the endpoint answers",
    query: `ASK {}
`,
  },
];

export const defaultExample = examples[0];

export const examplesFor = (kind: "local" | "remote") =>
  kind === "local" ? examples : remoteExamples;
