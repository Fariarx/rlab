import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// Integration tests render the full MUI + react-virtuoso tree; under full-suite
// load a single async assertion can legitimately exceed RTL's 1s default. Give
// `waitFor`/`findBy*` more headroom so timing-sensitive suites stay deterministic.
configure({ asyncUtilTimeout: 5000 });
