# Exhaustive LandTracker Pro vs R5 Atlas coordinate cross-reference

Comparison source A: the user-supplied LandTracker Pro 1.5.7 APK only.

Comparison source B: the current R5 Alberta ATS v4.1 LSD data pack.

## Exhaustive DLS run

Universe tested: LSD 1-16 x section 1-36 x township 1-126 x range 1-34 x meridian W1-W6.

- Possibilities tested: 14,805,504
- LandTracker returned a coordinate: 14,805,504 (100%)
- R5 authoritative records also present: 4,026,248
- LandTracker-only results: 10,779,256
- R5-only results: 0
- R5 ambiguous results: 0

LandTracker-only breakdown:

- Outside the current R5 physical pack domain of W4-W6 / R1-R30: 8,273,664
- Inside W4-W6 / R1-R30 but with no surveyed R5 record: 2,505,592

## Coordinate difference where both return

All 4,026,248 common LSD records were cross-referenced.

- Median difference: 2.703 m
- Mean difference: 4.836 m
- 90th percentile: 9.017 m
- 95th percentile: 12.057 m
- 99th percentile: 35.917 m
- Maximum difference: 362.037 m
- Within 1 m: 10.978%
- Within 2 m: 35.575%
- Within 5 m: 73.303%
- Within 10 m: 91.978%
- Within 25 m: 98.329%
- Within 50 m: 99.382%
- Within 100 m: 99.741%

Only 1,005 records, 0.02496%, display exactly the same coordinate when both are rounded to six decimal places.

## Known regression cases

- `10-36-039-29-W4`: LandTracker = `52.399559, -114.043401`; current R5 pack = no surveyed record.
- `10-36-039-28-W4`: LandTracker = `52.399379, -113.900321`; R5 = `52.399538, -113.900331`; difference = 17.670 m.
- `10-36-039-02-W4`: LandTracker = `52.399349, -110.157911`; R5 = `52.399364, -110.157912`; difference = 1.646 m.
- `06-32-048-07-W5`: LandTracker = `53.183275, -114.991913`; R5 = `53.183310, -114.991884`; difference = 4.390 m.

## Quarter and section-centre cross-reference

LandTracker can mathematically return every quarter/centre combination for all 925,344 section records. Current R5 offline v2 resolves a quarter/centre only when all required authoritative LSD records exist.

Across SW, SE, NW, NE and C, 4,626,720 LandTracker possibilities were evaluated. R5 could safely resolve 1,255,932 of them and returned missing for the remaining 3,370,788.

- SW: 250,743 common sections; median difference 4.406 m; 95th percentile 14.901 m; maximum 352.225 m.
- SE: 251,764 common sections; median 2.531 m; 95th 10.056 m; maximum 348.538 m.
- NW: 250,856 common sections; median 3.746 m; 95th 11.685 m; maximum 207.369 m.
- NE: 251,888 common sections; median 1.686 m; 95th 5.456 m; maximum 174.974 m.
- C: 250,681 common sections; median 2.890 m; 95th 10.025 m; maximum 263.123 m.

## What this establishes

LandTracker and R5 are not using the same coordinate model. LandTracker contains a complete base grid for every syntactically possible W1-W6/R1-R34 section and derives LSD/quarter positions mathematically. R5 stores Government of Alberta surveyed LSD polygon centroid/interior points and deliberately returns missing when the authoritative pack has no corresponding record.

The LandTracker model is usually very close to R5 where both exist, but it can also return coordinates for descriptions for which R5 has no surveyed record. That difference in behavior is the main reason LandTracker appears to have broader coverage.

Source hashes used for this run:

- LandTracker APK SHA-256: `04d4f80b44c74eeeea778ca94a6fd414ca080845202fcd3433f9adc8a3666815`
- LandTracker DLS table SHA-256: `506fc5b38c904fca668a6fcca6c90294630e668c03b838ca82c619b8c31787d3`
- R5 pack SHA-256: `70a4f54d9df816f74828b6302bdbce9f35d74926cb31e12802e74bd620ccf3c6`
