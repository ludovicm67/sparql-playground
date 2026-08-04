import type { Monaco } from "@monaco-editor/react";
import type { ResolvedTheme } from "./theme";

export const EDITOR_THEME = "sparql-playground";
export const EDITOR_THEME_LIGHT = "sparql-playground-light";

/** The Monaco theme matching a resolved app theme. */
export const editorThemeFor = (theme: ResolvedTheme) =>
  theme === "light" ? EDITOR_THEME_LIGHT : EDITOR_THEME;

/**
 * Themes built from the same tokens as `styles/globals.css`, so the editor
 * reads as part of the panel instead of a box pasted on top of it.
 */
export const defineEditorTheme = (monaco: Monaco) => {
  defineLightTheme(monaco);

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

/** The same theme against paper: same hues, darkened to hold their contrast. */
const defineLightTheme = (monaco: Monaco) => {
  monaco.editor.defineTheme(EDITOR_THEME_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "151922" },
      { token: "comment", foreground: "878fa3", fontStyle: "italic" },
      { token: "keyword", foreground: "5a3ddb" },
      { token: "operator", foreground: "5c6478" },
      { token: "delimiter", foreground: "5c6478" },
      { token: "delimiter.bracket", foreground: "151922" },
      { token: "string", foreground: "8a5a0b" },
      { token: "number", foreground: "1668b5" },
      { token: "tag", foreground: "1668b5" },
      { token: "identifier", foreground: "151922" },
      { token: "variable", foreground: "0d7a67" },
      { token: "type", foreground: "1668b5" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#151922",
      "editorLineNumber.foreground": "#b4bccd",
      "editorLineNumber.activeForeground": "#4d566b",
      "editorCursor.foreground": "#5a3ddb",
      "editor.lineHighlightBackground": "#f4f6fb",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#dcd6fb",
      "editor.inactiveSelectionBackground": "#ebedf5",
      "editorIndentGuide.background1": "#e9ecf4",
      "editorIndentGuide.activeBackground1": "#c3c9da",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#dde1ec",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#dde1ec",
      "editorGutter.background": "#ffffff",
      "scrollbarSlider.background": "#cdd3e199",
      "scrollbarSlider.hoverBackground": "#b4bccdcc",
      "scrollbarSlider.activeBackground": "#a4abbd",
      "editorOverviewRuler.border": "#00000000",
    },
  });
};
