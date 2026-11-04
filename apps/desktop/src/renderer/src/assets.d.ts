// Images imported by Vite become the file's URL.
declare module '*.png' { const url: string; export default url }
declare module '*.gif' { const url: string; export default url }
