# Critique ignore list

Findings matched here are dropped silently from future critique runs.

- **overused-font (Inter)** — false positive. Product register explicitly permits
  Inter (see product.md / PRODUCT.md). DESIGN.md commits Inter + JetBrains Mono
  deliberately under the No-Display-Font Rule. Inter is the body face; JetBrains
  Mono is the hero (the component tree). Not a slop tell here.
- **single-font** — false positive. The detector parses only the index.html
  Google Fonts <link> and reports one family; the dashboard uses two (Inter +
  JetBrains Mono). The mono is the signature surface (tree-as-hero). Mis-parse.
