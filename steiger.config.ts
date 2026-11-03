import { defineConfig } from "steiger"
import fsd from "@feature-sliced/steiger-plugin"

export default defineConfig([
  ...fsd.configs.recommended,
  {
    // Kiln is one page, so every widget is used by exactly one slice; that's the shape, not a smell.
    rules: { "fsd/insignificant-slice": "off" },
  },
])
