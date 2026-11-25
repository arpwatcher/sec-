# Security+ SY0-801 Mock Exams

Free CompTIA Security+ (SY0-801 V8) mock exams that run in the browser:
**https://arpwatcher.github.io/sec-/**

Each mock is a full exam form, written to be harder than the real test:

- 90 items in 90 minutes, with the published domain weights (14 / 22 / 17 / 25 / 12 items)
- performance-based questions first: firewall rule bases, log analysis, ordering and matching, with partial credit
- multiple choice with one answer or "Choose two", scored all or nothing
- the test-day tools: flag for review, strike out options, Previous / Next, and an item review screen listing all, incomplete and flagged items
- a score report: an estimated scaled score (100 to 900, 750 to pass), results by domain, the exam objectives to review, and every item with its explanation

A new mock is added every day. Progress and scores stay in your browser.

| Mock | Date | Items | PBQs |
| --- | --- | --- | --- |
| Mock Exam 1 | 2026-11-25 | 90 | 5 |

## Development

No build step: open `index.html` through any static server (`npm run serve`).

- `exams/mock-NN.js`: one file per mock, registered in `exams/index.js`
- `exams/objectives.js`: the SY0-801 domains, objectives and the 90-item blueprint
- `npm test`: validates every mock (90 items, blueprint, answer keys, PBQs, unique stems, balanced option lengths)
- `npm run smoke`: drives an exam in Chromium with Playwright (`SITE_ROOT=site` for a built site)
- `tools/build-site.mjs`: builds what GitHub Pages serves (the CI deploys it to the `gh-pages` branch)

The questions are original and written against the published exam objectives. They are not taken from any CompTIA exam. CompTIA and Security+ are trademarks of CompTIA, Inc.; this project is not affiliated with or endorsed by CompTIA.
