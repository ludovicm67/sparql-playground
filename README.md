# SPARQL playground

This is a playground for SPARQL queries.
It uses Oxigraph as a triple store and the editor is based on Monaco.

## Start it locally

```sh
# Install required dependencies
npm install

# Start the development server
npm run dev
```

And then open your browser at http://localhost:3000/

## Generate static content

To generate the static content, run the following command:

```sh
npm run build
```

And it would be available in the `out` directory.
