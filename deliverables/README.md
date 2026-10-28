# PlaceIQ deliverables

Everything prepared for submission and the presentation. Each Word document has a PDF copy beside it.

| File | What it is | Main reader |
|---|---|---|
| `PlaceIQ_Project_Report.docx` / `.pdf` | Full project report, about 36 pages: requirements, EER, mapping, normalization proofs, DDL, triggers, data, the five queries with results, transactions, indexing, security, application, testing summary, learnings | Professor |
| `PlaceIQ_Presentation.pptx` / `.pdf` | 18-slide deck for the 15-minute talk; each slide shows its presenter (M1–M4), and the speaker notes hold the script with timings | Audience, presenters |
| `PlaceIQ_Understanding_Guide.docx` / `.pdf` | Team study guide: every FDS concept mapped to the project, the accept-offer walkthrough, 40 viva questions with answers, per-member prep sheets, glossary, numbers cheat sheet | Team |
| `PlaceIQ_Testing_Report.docx` / `.pdf` | Test strategy, environment, results (91/91), requirement traceability, every test case, concurrency and performance results, defect log | Professor |
| `PlaceIQ_Demo_Runbook.docx` / `.pdf` | Click-by-click live-demo script with what to say, expected screens, checklists, fallbacks, troubleshooting | M4 (demo driver) |
| `PlaceIQ_Demo_Video.webm` | Captioned recording of the full demo: the backup if the live demo fails (plays in any browser or VLC) | Presenters |
| `diagrams/` | EER (2 views), relational schema, normalization, architecture, trigger flow, as SVG and PNG | Slides, report |
| `screenshots/` | One screenshot per demo step | Runbook, slides |

Team placeholders `[Member 2]`, `[Member 3]` and `[Member 4]` appear in every document. To fill them in, edit `TEAM` in `src/doclib.js` and `src/build_deck.js` and rebuild, or use Find & Replace in Word and PowerPoint.

## Rebuilding

Everything is generated from scripts, and every number comes from the database and the test results.

```powershell
# from the Project folder, with PostgreSQL running and the web app started (app\main.py)
app\.venv\Scripts\python -m pytest tests                  # 1. tests -> tests/results/*.json
app\.venv\Scripts\python deliverables\src\diagrams.py     # 2. diagrams
app\.venv\Scripts\python deliverables\src\record_demo.py  # 3. demo video + screenshots (needs the app on :8000)
app\.venv\Scripts\python deliverables\src\export_data.py  # 4. figures -> data.json
cd deliverables\src; npm install
node build_deck.js; node build_report.js; node build_guide.js; node build_testing.js; node build_runbook.js
cscript //nologo office_export.vbs docx-pdf <in.docx> <out.pdf>   # PDFs via installed Office
```
