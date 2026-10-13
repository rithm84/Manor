/// <reference types="vite/client" />

/** The package version, inlined by the `define` entry in `vite.config.ts`. */
declare const __MANOR_VERSION__: string

/** Monaco's Monarch language definitions ship without types; the editor reads only their keyword lists. */
declare module '@codingame/monaco-vscode-standalone-languages/languages/definitions/*.js' {
  export const language: { readonly keywords?: readonly string[] }
}
