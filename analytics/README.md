# PlaceIQ Analytics (Phase 4)

Which kinds of students does the placement process serve badly, and what should the committee do for each?

| File | What it is |
|---|---|
| [`../07_analytics.sql`](../07_analytics.sql) | SQL statistics (A1–A5), the feature view `v_student_features`, the segment tables, and segment queries S1–S2. Each query carries its business question, FDS concepts and relational algebra. |
| [`placeiq_kmeans.ipynb`](placeiq_kmeans.ipynb) | Fetches features via SQL, runs statistics (correlation, ANOVA, χ²), k-means (elbow + silhouette, k = 4), writes the labels back to the DB, then a logistic model to show the threshold trade-off |
| `placeiq_kmeans.html` | The executed notebook, viewable without Python |
| `figures/` | Seven PNG charts at 200 dpi, ready for slides |
| `build_notebook.py` | Generates the notebook (edit here, not in the .ipynb) |

## Run

```powershell
# from Project\ : rebuild the DB (includes 07_analytics.sql)
.\run_all.ps1
# needs: pip install "psycopg[binary]" pandas scikit-learn scipy matplotlib sqlalchemy nbconvert
cd analytics
python build_notebook.py
jupyter nbconvert --to notebook --execute --inplace placeiq_kmeans.ipynb
jupyter nbconvert --to html placeiq_kmeans.ipynb
```

## Headline results (seeded data)

- **CGPA matters:** final placement rate is 0% for a CGPA of 6–7, 6% for 7–8, 28% for 8–9 and 56% for 9–10 (A2).
- **Four segments** (k = 4, silhouette 0.30), built from profile only:

  | Segment | n | Accepted an offer |
  |---|---|---|
  | High-Achieving Generalists | 68 | 41% |
  | Tech Specialists | 56 | 36% (highest CTC) |
  | Selective Appliers | 19 | 0% |
  | At-Risk | 34 | 3% |

  Segment and outcome are strongly associated (χ² = 25.7, p ≈ 1e-5).
- **Selective Appliers** are the non-obvious group: average CGPA, an 88% interview rate, but only about 2.6 applications each. A CGPA cut-off would never flag them.
- **S2** turns the analysis into an action list: 52 students, of whom 29 need to apply more widely, 12 need a CV review and 10 need a technical workshop.
