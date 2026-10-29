"""Builds placeiq_kmeans.ipynb from the cells below.

Run:  python analytics/build_notebook.py
then: jupyter nbconvert --to notebook --execute --inplace analytics/placeiq_kmeans.ipynb
"""
from pathlib import Path

import nbformat as nbf

HERE = Path(__file__).parent
cells = []


def md(text):
    cells.append(nbf.v4.new_markdown_cell(text.strip()))


def code(text):
    cells.append(nbf.v4.new_code_cell(text.strip()))


md("""
# PlaceIQ Analytics: Segmenting Students for Placement Support

**FDS course project, Phase 4.** The PlaceIQ database (Phases 1–3) stores every application,
interview and offer of a placement season in 22 BCNF tables. This notebook answers one
question with that data:

> **Which kinds of students does the current placement process serve badly, and what should
> the committee do for each kind?**

**Workflow**

1. **SQL first.** Descriptive statistics and cross-tabs run *inside PostgreSQL*
   (`07_analytics.sql`, queries A1–A5). Only aggregates leave the database.
2. **Feature engineering in SQL.** The view `v_student_features` turns six normalized tables
   into one row per student.
3. **Statistics.** Correlation, ANOVA and χ² tests tell us which features carry signal
   *before* we fit any model.
4. **k-means clustering** on profile features, with *k* picked by elbow and silhouette.
5. **Write back.** The cluster labels go into the tables `segment` and `student_segment`,
   so SQL can query them (S1, S2).
6. **Threshold trade-off.** A logistic model of P(offer) shows how the threshold *t* trades
   false positives against false negatives.

*The data is simulated (seeded, reproducible) by `04_data.sql` and loaded through the real
triggers. The conclusions are about this simulated campus, but the method transfers
unchanged to real data.*
""")

md("""
## 0. Setup

All queries go through SQLAlchemy over the `psycopg` driver. `run_sql()` runs one labelled
query from `07_analytics.sql`, so the SQL shown on the slides and the SQL executed here
come from the same file.
""")

code(r'''
import re
import warnings
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import silhouette_score
from sklearn.model_selection import cross_val_predict
from sklearn.preprocessing import StandardScaler
from sqlalchemy import create_engine, text

warnings.filterwarnings("ignore", category=UserWarning)
pd.set_option("display.width", 140)

engine = create_engine("postgresql+psycopg://postgres:postgres@localhost/placeiq",
                       connect_args={"options": "-c search_path=placeiq,public"})

SQL_FILE = Path("..") / "07_analytics.sql"
FIG = Path("figures")
FIG.mkdir(exist_ok=True)

# A labelled query in 07_analytics.sql is a "-- A1. TITLE" header block,
# closed by a "-- ====" line, followed by one statement ending in ";".
_QUERY = re.compile(r"^-- ([AS]\d)\. ([^\n]*)\n.*?^-- =+\n\n(.*?;)\s*$", re.M | re.S)
QUERIES = {m[1]: (m[2].strip(), m[3]) for m in _QUERY.finditer(SQL_FILE.read_text(encoding="utf-8"))}

def run_sql(label):
    title, sql = QUERIES[label]
    print(f"{label}. {title}")
    with engine.connect() as c:
        return pd.read_sql(text(sql), c)

print("Queries found:", ", ".join(QUERIES))
''')

code(r'''
# Chart style: one recessive grid, thin marks, text in ink colours (never series colours).
INK, INK2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
BLUE, ORANGE, AQUA, YELLOW, RED, MID = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e34948", "#f0efec"
plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "axes.titlecolor": INK,
    "axes.titleweight": "bold", "axes.titlesize": 12, "axes.titlelocation": "left",
    "xtick.color": INK2, "ytick.color": INK2, "text.color": INK,
    "axes.grid": True, "axes.axisbelow": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "axes.spines.top": False, "axes.spines.right": False,
    "font.size": 10, "figure.dpi": 110,
})

def save(fig, name):
    fig.savefig(FIG / f"{name}.png", dpi=200, bbox_inches="tight")
''')

md("""
## 1. Descriptive statistics in SQL

The professor's question, "how many people aged 30–40 defaulted?", becomes "how many
students with a CGPA of 8–9 got placed?" here. The DBMS answers it with `GROUP BY`; we don't
need to load every record into memory.

### A1. CGPA distribution by program
""")

code('a1 = run_sql("A1"); a1')

md("""
**Reading A1.** Mean ≈ median (7.9) in every program, so the CGPA distribution is roughly
symmetric. The three programs have almost the same centre and spread. Is that difference
real? The ANOVA in §3 tests it.
""")

code('a2 = run_sql("A2"); a2')

code(r'''
fig, ax = plt.subplots(figsize=(6.4, 3.4))
bars = ax.bar(a2["cgpa_band"], a2["placed_pct"], color=BLUE, width=0.6, edgecolor=SURFACE, linewidth=2)
for b, pct, n in zip(bars, a2["placed_pct"], a2["students"]):
    ax.annotate(f"{pct:.0f}%  (n={n})", (b.get_x() + b.get_width() / 2, b.get_height()),
                xytext=(0, 4), textcoords="offset points", ha="center", color=INK, fontsize=9)
ax.set_title("Final placement rate climbs steeply with CGPA")
ax.set_xlabel("CGPA band"); ax.set_ylabel("% placed (final cycle)")
ax.set_ylim(0, max(a2["placed_pct"]) * 1.25); ax.grid(axis="x", visible=False)
save(fig, "01_cgpa_band"); plt.show()
''')

md("""
**Reading A2.** No student below a CGPA of 7 has a final placement yet, while more than half
of those above 9 do. CGPA is a strong feature, but it can't be the only one: about 70% of
the 8–9 band is still unplaced.
""")

code('run_sql("A3")')
code('run_sql("A4")')
code('run_sql("A5")')

md("""
**Reading A3–A5.**
* **Funnel (A3):** About 45% of applications reach an interview in every program, but only
  4–9% become offers. Most students drop out *after* the interview, not at CV screening.
* **Skills (A4):** SQL, Excel and Statistics have the most jobs per proficient student, so
  workshops there pay off most.
* **Salary (A5):** The PGP mean CTC is well above its median, so a few high offers pull the
  mean up. The brochure should quote the median.
""")

md("""
## 2. Feature engineering: `v_student_features`

Feature engineering means turning the problem into data, using domain knowledge. A placement
committee sees five things about a student early in the season:

| Feature | Why it should matter | Built from |
|---|---|---|
| `cgpa` | Recruiters' first filter (A2) | `student` |
| `tech_score` | Analytics roles screen on Python, SQL, ML, … | `student_skill ⋈ skill` |
| `biz_score` | Consulting and finance roles screen on cases, Excel, communication | `student_skill ⋈ skill` |
| `applications` | You can't get an offer you didn't apply for | `application` |
| `interview_rate` | Share of applications that reached an interview (CV quality) | `application`, `interview` |

Outcomes (`offers`, `accepted_offer`, `best_ctc_lpa`) are **not** clustering inputs. We
cluster on the profile and then check whether the segments differ in outcomes. Clustering on
outcomes would make "students with many offers do well" true by construction.

The view runs one SQL statement over six tables. The single `SELECT` below is the only time
student-level data leaves the database.
""")

code(r'''
with engine.connect() as c:
    df = pd.read_sql(text("SELECT * FROM v_student_features ORDER BY student_id"), c)

FEATURES = ["cgpa", "tech_score", "biz_score", "applications", "interview_rate"]
OUTCOMES = ["offers", "accepted_offer", "best_ctc_lpa", "avg_interview_score"]
df["accepted_offer"] = df["accepted_offer"].astype(int)
print(df.shape)
df.head()
''')

code('df[FEATURES + OUTCOMES].describe().T.round(2)')

md("""
## 3. Statistics before modelling

Before fitting any algorithm, statistics tell us how the data behaves and which features
carry signal.
""")

code(r'''
corr = df[FEATURES + ["offers", "accepted_offer"]].astype(float).corr()

from matplotlib.colors import LinearSegmentedColormap
diverging = LinearSegmentedColormap.from_list("blue_gray_red", [BLUE, MID, RED])

fig, ax = plt.subplots(figsize=(6.2, 5.2))
im = ax.imshow(corr, cmap=diverging, vmin=-1, vmax=1)
ax.set_xticks(range(len(corr)), corr.columns, rotation=40, ha="right")
ax.set_yticks(range(len(corr)), corr.columns)
ax.grid(False)
for i in range(len(corr)):
    for j in range(len(corr)):
        ax.text(j, i, f"{corr.iloc[i, j]:.2f}", ha="center", va="center", fontsize=8, color=INK)
ax.set_title("Pearson correlation: profile features and outcomes")
fig.colorbar(im, ax=ax, shrink=0.75)
save(fig, "02_correlation"); plt.show()
''')

md("""
**Reading the correlations.**
* `tech_score` and `biz_score` are strongly **negative**: students specialise in one or the
  other. That is the first axis the clusters will find.
* `cgpa` and `applications` both correlate positively with `offers`.
* No pair of features is so correlated that one is redundant, so we keep all five.
""")

code(r'''
groups = [g["cgpa"].values for _, g in df.groupby("program_code")]
f, p = stats.f_oneway(*groups)
print(f"One-way ANOVA, CGPA across programs:  F = {f:.2f},  p = {p:.3f}")

pointbiserial = {}
for col in ["cgpa", "applications", "interview_rate"]:
    r, p = stats.pointbiserialr(df["accepted_offer"], df[col])
    pointbiserial[col] = {"r": round(float(r), 2), "p": float(f"{p:.2g}")}
    print(f"Point-biserial r(accepted_offer, {col:15s}) = {r:+.2f}   p = {p:.2g}")
''')

md("""
**Reading the tests.**
* **ANOVA** (H₀: all programs have the same mean CGPA): p is large, so we do **not** reject
  H₀. Program does not affect CGPA, so CGPA and program measure different things.
* **Point-biserial correlations:** CGPA and the number of applications are significantly
  associated with getting an offer.
""")

md("""
## 4. k-means clustering

**Why scale first?** k-means uses Euclidean distance. Unscaled, `applications` (0–20) would
swamp `interview_rate` (0–1). `StandardScaler` puts every feature on mean 0, SD 1, so each
feature gets an equal vote.

**Choosing k:** the *elbow* in the within-cluster sum of squares (inertia), checked against
the *silhouette* score (how much closer each point is to its own cluster than to the next
one; higher is better).
""")

code(r'''
X = StandardScaler().fit_transform(df[FEATURES].astype(float))

ks = range(2, 9)
fits = {k: KMeans(n_clusters=k, n_init=20, random_state=42).fit(X) for k in ks}
inertia = [fits[k].inertia_ for k in ks]
silhouette = [silhouette_score(X, fits[k].labels_) for k in ks]
pd.DataFrame({"k": list(ks), "inertia": np.round(inertia, 1), "silhouette": np.round(silhouette, 3)})
''')

code(r'''
K = 4
fig, (a, b) = plt.subplots(1, 2, figsize=(9.6, 3.3))
a.plot(list(ks), inertia, color=BLUE, lw=2, marker="o", ms=6)
a.set_title("Elbow: inertia vs k"); a.set_xlabel("k"); a.set_ylabel("within-cluster SS")
b.plot(list(ks), silhouette, color=BLUE, lw=2, marker="o", ms=6)
b.set_title("Silhouette vs k"); b.set_xlabel("k"); b.set_ylabel("mean silhouette")
for ax, ys in ((a, inertia), (b, silhouette)):
    ax.plot([K], [ys[K - 2]], marker="o", ms=11, mfc="none", mec=INK, mew=1.5)
    ax.annotate(f"k = {K}", (K, ys[K - 2]), xytext=(10, -4), textcoords="offset points",
                va="top", color=INK)
save(fig, "03_choose_k"); plt.show()
''')

md("""
**Choosing k = 4.** Inertia falls steeply up to k = 4 and flattens after, and the silhouette
peaks at k = 4. A score near 0.3 means the segments overlap somewhat, which is normal for
people data. We also check that each segment makes sense to a placement committee.
""")

code(r'''
km = fits[K]
df["cluster"] = km.labels_

# Name clusters from their centroids, not from the arbitrary k-means index,
# so the names stay right if the seed changes.
cent = df.groupby("cluster")[FEATURES].mean()
names = {}
tech = cent["tech_score"].idxmax();                          names[tech] = "Tech Specialists"
rest = cent.drop(index=tech)
gen = rest["applications"].idxmax();                         names[gen] = "High-Achieving Generalists"
rest = rest.drop(index=gen)
sel = rest["interview_rate"].idxmax();                       names[sel] = "Selective Appliers"
names[rest.drop(index=sel).index[0]] = "At-Risk"

ORDER = ["High-Achieving Generalists", "Tech Specialists", "Selective Appliers", "At-Risk"]
COLOR = dict(zip(ORDER, [AQUA, BLUE, YELLOW, ORANGE]))   # colour follows the segment, fixed
df["segment_name"] = df["cluster"].map(names)

profile = (df.groupby("segment_name")
             .agg(students=("cgpa", "size"),
                  cgpa=("cgpa", "mean"), tech=("tech_score", "mean"), biz=("biz_score", "mean"),
                  apps=("applications", "mean"), interview_rate=("interview_rate", "mean"),
                  offers=("offers", "mean"), accepted_pct=("accepted_offer", "mean"),
                  best_ctc=("best_ctc_lpa", "mean"))
             .reindex(ORDER))
profile["accepted_pct"] *= 100
profile.round(2)
''')

code(r'''
# Where the segments sit: 2-D PCA projection, one panel per segment
# (four colours on one scatter are hard to tell apart, so we use small multiples).
pca = PCA(n_components=2, random_state=42).fit(X)
P = pca.transform(X)
ev = pca.explained_variance_ratio_ * 100

fig, axes = plt.subplots(1, 4, figsize=(13, 3.4), sharex=True, sharey=True)
for ax, name in zip(axes, ORDER):
    m = (df["segment_name"] == name).values
    ax.scatter(P[~m, 0], P[~m, 1], s=14, color="#c9c8c3", lw=0)
    ax.scatter(P[m, 0], P[m, 1], s=26, color=COLOR[name], edgecolor=SURFACE, lw=0.8)
    ax.set_title(f"{name}\n(n = {m.sum()})", fontsize=10)
    ax.set_xlabel(f"PC1 ({ev[0]:.0f}% var)")
axes[0].set_ylabel(f"PC2 ({ev[1]:.0f}% var)")
fig.suptitle("Four student segments (k-means, k = 4) on the first two principal components",
             x=0.01, ha="left", fontweight="bold", color=INK)
fig.tight_layout()
save(fig, "04_segments_pca"); plt.show()

print("PC loadings:")
pd.DataFrame(pca.components_.T, index=FEATURES, columns=["PC1", "PC2"]).round(2)
''')

code(r'''
# What makes each segment different: centroid in standard-deviation units.
z = pd.DataFrame(X, columns=FEATURES).assign(segment_name=df["segment_name"]).groupby("segment_name").mean().reindex(ORDER)
labels = ["CGPA", "Tech skills", "Business skills", "Applications", "Interview rate"]

fig, axes = plt.subplots(1, 4, figsize=(13, 3.0), sharey=True, sharex=True)
for ax, name in zip(axes, ORDER):
    vals = z.loc[name].values
    ax.barh(labels, vals, color=COLOR[name], height=0.6, edgecolor=SURFACE, linewidth=2)
    ax.axvline(0, color=INK2, lw=0.8)
    for y, v in enumerate(vals):
        ax.text(v + (0.08 if v >= 0 else -0.08), y, f"{v:+.1f}", va="center",
                ha="left" if v >= 0 else "right", fontsize=8, color=INK)
    ax.set_title(name, fontsize=10); ax.set_xlim(-2.4, 2.4); ax.grid(axis="y", visible=False)
    ax.set_xlabel("SD from campus mean")
axes[0].invert_yaxis()
fig.suptitle("Segment fingerprints: how far each centroid sits from the average student",
             x=0.01, ha="left", fontweight="bold", color=INK)
fig.tight_layout()
save(fig, "05_segment_fingerprints"); plt.show()
''')

md("""
## 5. Do the segments differ in outcomes?

The segments were built **without** looking at offers. If they still differ sharply in
placement outcomes, the profile features capture something real.
""")

code(r'''
ct = pd.crosstab(df["segment_name"], df["accepted_offer"]).reindex(ORDER)
chi2, p_chi, dof, _ = stats.chi2_contingency(ct)
print(f"Chi-square test of independence, segment x accepted_offer: chi2 = {chi2:.1f}, dof = {dof}, p = {p_chi:.2g}")
h, p_kw = stats.kruskal(*[g["offers"] for _, g in df.groupby("segment_name")])
print(f"Kruskal-Wallis, offers across segments: H = {h:.1f}, p = {p_kw:.2g}")

fig, ax = plt.subplots(figsize=(6.8, 3.2))
vals = profile["accepted_pct"]
bars = ax.barh(ORDER, vals, color=[COLOR[n] for n in ORDER], height=0.6, edgecolor=SURFACE, linewidth=2)
for b, v, n in zip(bars, vals, profile["students"]):
    ax.text(b.get_width() + 0.8, b.get_y() + b.get_height() / 2, f"{v:.0f}%  (n={n})",
            va="center", fontsize=9, color=INK)
ax.invert_yaxis(); ax.set_xlim(0, max(vals) * 1.3); ax.grid(axis="y", visible=False)
ax.set_xlabel("% of segment with an accepted offer (summer or final)")
ax.set_title("Segments built from profile alone split sharply on outcome")
save(fig, "06_segment_outcomes"); plt.show()
''')

md("""
**Reading the outcome test.** The χ² test rejects independence (p ≪ 0.05): segment
membership and getting an offer are strongly associated, so the clusters are meaningful,
not just geometry.

| Segment | Who they are | What the committee should do |
|---|---|---|
| **High-Achieving Generalists** | High CGPA, business skills, apply widely | Nothing urgent. Help them choose between offers |
| **Tech Specialists** | Almost all PGDBA, strong technical skills, highest CTC | Steer them towards analytics roles, where their skills match the demand in A4 |
| **Selective Appliers** | Apply to very few roles but usually reach interview; still no offers | **Broaden their applications.** Their CVs work, but they apply to too few roles |
| **At-Risk** | Lower CGPA, few applications, rarely reach interview | **Priority group:** CV review, then mock interviews (query S2 lists them by name) |

The "Selective Appliers" are the non-obvious finding. A CGPA cut-off would never flag them,
because their CGPA is near average. The clusters found them through *behaviour*.
""")

md("""
## 6. Write the segments back to the database

The labels belong in the database, not in a CSV on one person's laptop. One transaction
replaces the old segmentation: either every student gets the new label, or nothing changes.
""")

code(r'''
desc = {
    "High-Achieving Generalists": "High CGPA, business skills, many applications; best placement outcomes",
    "Tech Specialists": "Technical-skill heavy (mostly PGDBA); highest CTC",
    "Selective Appliers": "Few applications but high interview rate; offers not converting",
    "At-Risk": "Lower CGPA, few applications, low interview rate; needs intervention",
}
seg_rows = [{"segment": i, "segment_name": n, "description": desc[n]} for i, n in enumerate(ORDER)]
seg_id = {n: i for i, n in enumerate(ORDER)}
member_rows = [{"student_id": int(s), "segment": seg_id[n]} for s, n in zip(df["student_id"], df["segment_name"])]

with engine.begin() as c:                       # BEGIN ... COMMIT (ROLLBACK on any error)
    c.execute(text("DELETE FROM student_segment"))
    c.execute(text("DELETE FROM segment"))
    c.execute(text("INSERT INTO segment (segment, segment_name, description) "
                   "VALUES (:segment, :segment_name, :description)"), seg_rows)
    c.execute(text("INSERT INTO student_segment (student_id, segment) VALUES (:student_id, :segment)"),
              member_rows)

with engine.connect() as c:
    display(pd.read_sql(text("SELECT * FROM v_segment_profile ORDER BY segment"), c))
''')

md("""
Now SQL can answer questions about the segments.

### S1. How is each program spread across the segments?
""")

code('run_sql("S1")')

md("""
**Reading S1.** PGDBA is almost all one segment, but PGP and PGPEX each split across three
segments. A program-wide policy ("one workshop for all PGP students") would miss most of
their at-risk students.

### S2. Who needs help now?
""")

code('s2 = run_sql("S2"); print(len(s2), "students"); display(s2.groupby(["segment_name", "suggested_action"]).size().rename("students")); s2.head(12)')

md("""
**Reading S2.** The query flags every segment whose acceptance rate is below the campus
average (Selective Appliers and At-Risk): 52 students, each with one suggested action. More
than half (29) simply need to *apply to more roles*, which costs the committee nothing but
a reminder. 12 need a CV review, and about 10 need a technical-skills workshop.
""")

md("""
## 7. The threshold *t*: false positives vs false negatives

Classification gives a probability, P(offer | profile), and someone has to pick a threshold
*t* to turn it into a decision. Here the decision is "flag this student for support if
P(offer) < *t*". The table shows the trade-off:
* **t too low:** we miss students who needed help and got no offer (false negatives).
* **t too high:** we spend workshop seats on students who would have been fine (false positives).

Probabilities are 5-fold cross-validated, so every student is scored by a model that never
saw them.
""")

code(r'''
y_no_offer = (df["offers"] == 0).astype(int)              # 1 = needs help
p_offer = cross_val_predict(LogisticRegression(max_iter=1000), X, 1 - y_no_offer,
                            cv=5, method="predict_proba")[:, 1]

rows = []
for t in np.arange(0.1, 0.91, 0.1):
    flag = (p_offer < t).astype(int)
    tp = int(((flag == 1) & (y_no_offer == 1)).sum()); fp = int(((flag == 1) & (y_no_offer == 0)).sum())
    fn = int(((flag == 0) & (y_no_offer == 1)).sum()); tn = int(((flag == 0) & (y_no_offer == 0)).sum())
    rows.append({"t": round(t, 1), "flagged": tp + fp, "TP": tp, "FP": fp, "FN": fn, "TN": tn,
                 "precision": round(tp / max(tp + fp, 1), 2), "recall": round(tp / max(tp + fn, 1), 2)})
thr = pd.DataFrame(rows); thr
''')

code(r'''
fig, ax = plt.subplots(figsize=(6.4, 3.4))
ax.plot(thr["t"], thr["precision"], color=BLUE, lw=2, marker="o", ms=6)
ax.plot(thr["t"], thr["recall"], color=ORANGE, lw=2, marker="s", ms=6)
ax.text(thr["t"].iloc[-1] + 0.02, thr["precision"].iloc[-1], "precision", color=INK, va="center")
ax.text(thr["t"].iloc[-1] + 0.02, thr["recall"].iloc[-1], "recall", color=INK, va="center")
ax.set_xlim(0.05, 1.05); ax.set_ylim(0, 1.05)
ax.set_xlabel("threshold t  (flag if P(offer) < t)"); ax.set_ylabel("score")
ax.set_title("Raising t catches more students who need help, at the cost of precision")
ax.legend(["precision: flagged students who really had no offer",
           "recall: students with no offer who got flagged"], fontsize=8, frameon=False, loc="lower left")
save(fig, "07_threshold"); plt.show()

coef = LogisticRegression(max_iter=1000).fit(X, 1 - y_no_offer).coef_[0]
pd.Series(coef, index=FEATURES, name="logit coefficient (per SD)").round(2).sort_values()
''')

code(r'''
# Headline numbers for the slides and report (read by deliverables/src/export_data.py).
import json
f_anova, p_anova = stats.f_oneway(*groups)
results = {
    "n_students": int(len(df)), "features": FEATURES, "k": K,
    "k_scan": [{"k": k, "inertia": round(float(i), 1), "silhouette": round(float(s), 3)}
               for k, i, s in zip(ks, inertia, silhouette)],
    "anova_cgpa_program": {"F": round(float(f_anova), 2), "p": round(float(p_anova), 3)},
    "chi2_segment_offer": {"chi2": round(float(chi2), 1), "dof": int(dof), "p": float(f"{p_chi:.2g}")},
    "corr_tech_biz": round(float(corr.loc["tech_score", "biz_score"]), 2),
    "pointbiserial_accepted": pointbiserial,
    "kruskal_offers": {"H": round(float(h), 1), "p": float(f"{p_kw:.2g}")},
    "pca_var_pct": [round(float(v), 1) for v in ev],
    "logit_coef": {f: round(float(c), 2) for f, c in zip(FEATURES, coef)},
    "threshold": thr.to_dict(orient="records"),
}
Path("results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print("wrote results.json")
''')

md("""
**Reading the threshold.** The committee sets *t* according to which mistake costs more.
Missing a student who ends up with no offer is worse than one extra workshop seat, so a
higher *t* (about 0.6–0.7) is defensible. The coefficients agree with the clusters: CGPA
and the number of applications have the largest positive effects on P(offer), while
interview rate on its own adds little.

## 8. Conclusions

1. **The DBMS did most of the analytics work.** Statistics, cross-tabs, the funnel, skill
   gaps and the whole feature matrix are SQL. Python received 177 rows × 5 features, not
   thousands of raw records.
2. **CGPA matters but isn't enough.** The placement rate rises from 0% to 56% across CGPA
   bands, yet behaviour (how many roles a student applies to) separates the segments that
   CGPA can't.
3. **Four segments, four actions.** The k-means segments, built without outcome data, differ
   significantly in placement (χ² test). Two of them, *Selective Appliers* and *At-Risk*,
   need different help.
4. **Back into the database.** The labels live in BCNF tables with foreign keys, so S2
   turns the analysis into a weekly to-do list for the committee.

**Limitations.** The data is simulated, so the effect sizes reflect how `04_data.sql`
generated it. The final cycle is still in progress, so the outcomes are a snapshot. A
silhouette of about 0.3 means the segment boundaries are soft, so treat borderline students
individually.
""")

nb = nbf.v4.new_notebook()
nb["cells"] = cells
nb["metadata"]["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
nbf.write(nb, HERE / "placeiq_kmeans.ipynb")
print("wrote", HERE / "placeiq_kmeans.ipynb")
