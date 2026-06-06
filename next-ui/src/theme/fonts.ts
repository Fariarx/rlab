/**
 * Font loading via @fontsource (bundled, offline/headless — no CDN).
 *
 * Only the weights the kit actually uses are imported to keep the bundle small:
 * JetBrains Mono 400/500/700 (the defining typeface) and Inter 400/600/700 for
 * body copy. Importing this module for its side effects registers the @font-face
 * rules; import it once, early, in main.tsx.
 */
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

export { fonts } from "./tokens";
