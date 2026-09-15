# R5 Atlas converter testing

This folder is intentionally isolated from the production R5 Atlas page.

Open `testing/index.html` through GitHub Pages to test the replacement LSD coordinate engine.

## Two test modes

1. Sample mode works immediately and includes reference LSDs from W4, W5, and W6.
2. Full pack mode accepts `alberta-ats-v41-lsd.bin.gz` from the replacement package and then supports arbitrary Alberta LSD lookups.

The browser implementation uses the same section index, binary decoding, coordinate scaling, missing record handling, and ambiguous record handling as the replacement Python converter.

Nothing in this folder changes the root production page.
