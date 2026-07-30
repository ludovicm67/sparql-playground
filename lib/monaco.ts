import type { Monaco } from "@monaco-editor/react";

export const EDITOR_THEME = "sparql-playground";

/**
 * A theme built from the same tokens as `styles/globals.css`, so the editor
 * reads as part of the panel instead of a box pasted on top of it.
 */
export const defineEditorTheme = (monaco: Monaco) => {
  monaco.editor.defineTheme(EDITOR_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e8ebf2" },
      { token: "comment", foreground: "5b6580", fontStyle: "italic" },
      { token: "keyword", foreground: "a394ff" },
      { token: "operator", foreground: "8b93a7" },
      { token: "delimiter", foreground: "8b93a7" },
      { token: "delimiter.bracket", foreground: "e8ebf2" },
      { token: "string", foreground: "f7c66b" },
      { token: "number", foreground: "7cc4fa" },
      { token: "tag", foreground: "7cc4fa" },
      { token: "identifier", foreground: "e8ebf2" },
      { token: "variable", foreground: "5fd8c4" },
      { token: "type", foreground: "7cc4fa" },
    ],
    colors: {
      "editor.background": "#11141b",
      "editor.foreground": "#e8ebf2",
      "editorLineNumber.foreground": "#3b4356",
      "editorLineNumber.activeForeground": "#98a2b8",
      "editorCursor.foreground": "#a394ff",
      "editor.lineHighlightBackground": "#161a24",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#2f2b57",
      "editor.inactiveSelectionBackground": "#1e2130",
      "editorIndentGuide.background1": "#1e2431",
      "editorIndentGuide.activeBackground1": "#333c50",
      "editorWidget.background": "#151923",
      "editorWidget.border": "#232a38",
      "editorSuggestWidget.background": "#151923",
      "editorSuggestWidget.border": "#232a38",
      "editorGutter.background": "#11141b",
      "scrollbarSlider.background": "#232a3899",
      "scrollbarSlider.hoverBackground": "#2f3646cc",
      "scrollbarSlider.activeBackground": "#3b4356",
      "editorOverviewRuler.border": "#00000000",
    },
  });
};
