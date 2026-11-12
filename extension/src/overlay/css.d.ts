// esbuild charge les fichiers .css en texte (loader "text" dans build.mjs).
declare module "*.css" {
  const text: string;
  export default text;
}
