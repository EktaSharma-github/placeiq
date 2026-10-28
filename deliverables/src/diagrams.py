"""
Generates the project diagrams as SVG, then renders each to a 2x PNG with
headless Microsoft Edge.

    app\\.venv\\Scripts\\python deliverables\\src\\diagrams.py

Outputs to deliverables/diagrams/:
  eer_people.svg/png      EER part 1: Person hierarchy (overlapping), Sponsor union type
  eer_pipeline.svg/png    EER part 2: aggregation, weak entity, disjoint/total specialization
  schema.svg/png          Relational schema, columns read live from the database catalog
  normalization.svg/png   UNF -> 1NF -> 2NF -> 3NF -> BCNF
  architecture.svg/png    System architecture
  trigger_flow.svg/png    sp_accept_offer + one-offer trigger cascade
"""

import html
import math
import os
import subprocess
from pathlib import Path

import psycopg

OUT = Path(__file__).resolve().parent.parent / "diagrams"
OUT.mkdir(exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

INDIGO, INDIGO_SOFT = "#4f46e5", "#eef0ff"
AMBER, AMBER_SOFT = "#c2410c", "#fff4e6"
SLATE, INK, MUTED = "#94a3b8", "#0f172a", "#64748b"
GREEN, GREEN_SOFT = "#0f766e", "#e6f6f3"
FONT = "Segoe UI, Arial, sans-serif"


def esc(t):
    return html.escape(str(t))


class Svg:
    def __init__(self, w, h, title=""):
        self.w, self.h = w, h
        self.back, self.lines, self.shapes = [], [], []
        if title:
            self.shapes.append(f'<text x="24" y="34" font-size="20" font-weight="700" fill="{INK}">{esc(title)}</text>')

    # ---- primitives
    def text(self, x, y, t, size=14, weight=400, color=INK, anchor="middle", italic=False, underline=None):
        deco = ""
        if underline == "solid":
            deco = ' text-decoration="underline"'
        style = ' font-style="italic"' if italic else ""
        self.shapes.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" '
                           f'text-anchor="{anchor}" dominant-baseline="middle"{deco}{style}>{esc(t)}</text>')

    def line(self, pts, double=False, color=INK, width=1.6, dashed=False, arrow=False, layer=None):
        layer = self.lines if layer is None else layer
        dash = ' stroke-dasharray="6 4"' if dashed else ""
        mark = ' marker-end="url(#arrow)"' if arrow else ""
        d = "M " + " L ".join(f"{x},{y}" for x, y in pts)
        if double:
            layer.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width + 4.2}" stroke-linejoin="round"/>')
            layer.append(f'<path d="{d}" fill="none" stroke="#ffffff" stroke-width="{width + 0.6}" stroke-linejoin="round"/>')
        else:
            layer.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dash}{mark} stroke-linejoin="round"/>')

    def card(self, x, y, t):
        self.shapes.append(f'<text x="{x}" y="{y}" font-size="14" font-weight="700" fill="{AMBER}" '
                           f'text-anchor="middle" dominant-baseline="middle">{esc(t)}</text>')

    # ---- Chen notation
    def entity(self, x, y, label, weak=False, w=170, h=46):
        r = f'<rect x="{x - w / 2}" y="{y - h / 2}" width="{w}" height="{h}" fill="{INDIGO_SOFT}" stroke="{INDIGO}" stroke-width="2"/>'
        if weak:
            r += f'<rect x="{x - w / 2 + 5}" y="{y - h / 2 + 5}" width="{w - 10}" height="{h - 10}" fill="none" stroke="{INDIGO}" stroke-width="1.6"/>'
        self.shapes.append(r)
        self.text(x, y + 1, label, size=14, weight=700, color="#1e1b4b")

    def rel(self, x, y, label, ident=False, w=150, h=62):
        pts = f"{x},{y - h / 2} {x + w / 2},{y} {x},{y + h / 2} {x - w / 2},{y}"
        s = f'<polygon points="{pts}" fill="{AMBER_SOFT}" stroke="{AMBER}" stroke-width="2"/>'
        if ident:
            k = 0.78
            pts2 = f"{x},{y - h * k / 2} {x + w * k / 2},{y} {x},{y + h * k / 2} {x - w * k / 2},{y}"
            s += f'<polygon points="{pts2}" fill="none" stroke="{AMBER}" stroke-width="1.6"/>'
        self.shapes.append(s)
        self.text(x, y + 1, label, size=11.5, weight=700, color="#7c2d12")

    def attr(self, x, y, label, kind="plain", owner=None):
        rx, ry = max(42, len(label) * 4.4 + 16), 17
        if owner:
            self.line([owner, (x, y)], color=SLATE, width=1.3)
        stroke = f'stroke="{MUTED}" stroke-width="1.5"'
        dash = ' stroke-dasharray="5 3"' if kind == "derived" else ""
        s = f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="#ffffff" {stroke}{dash}/>'
        if kind == "multi":
            s += f'<ellipse cx="{x}" cy="{y}" rx="{rx - 4}" ry="{ry - 4}" fill="none" {stroke}/>'
        self.shapes.append(s)
        if kind in ("key", "partial"):
            tw = len(label) * 6.6
            dash_u = ' stroke-dasharray="4 3"' if kind == "partial" else ""
            self.shapes.append(f'<line x1="{x - tw / 2}" y1="{y + 8}" x2="{x + tw / 2}" y2="{y + 8}" stroke="{INK}" stroke-width="1.2"{dash_u}/>')
        self.text(x, y, label, size=12, color=INK)

    def circle(self, x, y, sym, r=17):
        self.shapes.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#ffffff" stroke="{INK}" stroke-width="2"/>')
        self.text(x, y + 1, sym, size=15, weight=700)

    def box(self, x, y, w, h, fill, stroke, dashed=False, rx=14, label=None, label_color=None, back=True):
        dash = ' stroke-dasharray="8 5"' if dashed else ""
        s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.8"{dash}/>'
        (self.back if back else self.shapes).append(s)
        if label:
            (self.back if back else self.shapes).append(
                f'<text x="{x + 14}" y="{y + 20}" font-size="12.5" font-weight="700" fill="{label_color or stroke}">{esc(label)}</text>')

    def legend(self, x, y, items):
        for i, (kind, text) in enumerate(items):
            yy = y + i * 30
            if kind == "entity":
                self.shapes.append(f'<rect x="{x}" y="{yy - 10}" width="34" height="20" fill="{INDIGO_SOFT}" stroke="{INDIGO}" stroke-width="1.6"/>')
            elif kind == "weak":
                self.shapes.append(f'<rect x="{x}" y="{yy - 10}" width="34" height="20" fill="{INDIGO_SOFT}" stroke="{INDIGO}" stroke-width="1.6"/>'
                                   f'<rect x="{x + 3}" y="{yy - 7}" width="28" height="14" fill="none" stroke="{INDIGO}" stroke-width="1.2"/>')
            elif kind == "rel":
                self.shapes.append(f'<polygon points="{x + 17},{yy - 11} {x + 34},{yy} {x + 17},{yy + 11} {x},{yy}" fill="{AMBER_SOFT}" stroke="{AMBER}" stroke-width="1.6"/>')
            elif kind == "double":
                self.shapes.append(f'<line x1="{x}" y1="{yy - 2.5}" x2="{x + 34}" y2="{yy - 2.5}" stroke="{INK}" stroke-width="1.6"/>'
                                   f'<line x1="{x}" y1="{yy + 2.5}" x2="{x + 34}" y2="{yy + 2.5}" stroke="{INK}" stroke-width="1.6"/>')
            elif kind == "derived":
                self.shapes.append(f'<ellipse cx="{x + 17}" cy="{yy}" rx="17" ry="10" fill="#fff" stroke="{MUTED}" stroke-dasharray="4 2" stroke-width="1.4"/>')
            elif kind == "multi":
                self.shapes.append(f'<ellipse cx="{x + 17}" cy="{yy}" rx="17" ry="10" fill="#fff" stroke="{MUTED}" stroke-width="1.4"/>'
                                   f'<ellipse cx="{x + 17}" cy="{yy}" rx="13" ry="6.5" fill="none" stroke="{MUTED}" stroke-width="1.2"/>')
            elif kind == "key":
                self.shapes.append(f'<ellipse cx="{x + 17}" cy="{yy}" rx="17" ry="10" fill="#fff" stroke="{MUTED}" stroke-width="1.4"/>'
                                   f'<line x1="{x + 9}" y1="{yy + 3}" x2="{x + 25}" y2="{yy + 3}" stroke="{INK}" stroke-width="1.2"/>')
            else:
                self.circle(x + 17, yy, kind, r=11)
            self.text(x + 46, yy, text, size=12.5, anchor="start", color="#334155")

    def save(self, name):
        defs = (f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
                f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{MUTED}"/></marker></defs>')
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
               f'viewBox="0 0 {self.w} {self.h}" font-family="{FONT}">{defs}'
               f'<rect width="100%" height="100%" fill="#ffffff"/>'
               + "".join(self.back) + "".join(self.lines) + "".join(self.shapes) + "</svg>")
        path = OUT / f"{name}.svg"
        path.write_text(svg, encoding="utf-8")
        return path


# =====================================================================
# EER part 1: people and sponsorship
# =====================================================================

def eer_people():
    s = Svg(1640, 860, "EER (1/2): people, programs and sponsorship")
    P = (820, 120)
    s.entity(*P, "PERSON")
    s.attr(610, 75, "person_id", "key", owner=P)
    s.attr(610, 160, "email", owner=P)
    s.attr(1040, 75, "name", owner=P)
    s.attr(1210, 52, "first_name", owner=(1040, 75))
    s.attr(1210, 100, "last_name", owner=(1040, 75))
    s.attr(1040, 160, "phone", owner=P)

    O = (820, 235)
    s.line([P, O])                          # partial participation: single line
    s.circle(*O, "o")
    subs = {"STUDENT": (290, 350), "COMMITTEE_MEMBER": (620, 350), "ALUMNUS": (1040, 350), "RECRUITER": (1400, 350)}
    for name, xy in subs.items():
        s.line([O, xy])
        s.entity(*xy, name, w=190 if name == "COMMITTEE_MEMBER" else 170)
    s.text(905, 228, "overlapping, partial", size=12, color=MUTED, anchor="start", italic=True)

    st = subs["STUDENT"]
    s.attr(95, 285, "roll_no", owner=st)
    s.attr(95, 345, "cgpa", owner=st)
    s.attr(95, 410, "skills", "multi", owner=st)
    s.attr(270, 460, "placement_status", "derived", owner=st)
    s.attr(620, 440, "cc_role", owner=subs["COMMITTEE_MEMBER"])

    PR = (820, 690)
    s.entity(*PR, "PROGRAM")
    s.attr(820, 775, "program_code", "key", owner=PR)
    s.rel(520, 560, "ENROLLED_IN")
    s.line([(330, 372), (520, 560)], double=True)
    s.line([(520, 560), PR])
    s.card(338, 440, "N"); s.card(700, 650, "1")
    s.rel(1010, 545, "GRADUATED_FROM", w=170)
    s.line([(1010, 372), (1010, 545)], double=True)
    s.line([(1010, 545), PR])
    s.card(1028, 400, "N"); s.card(925, 650, "1")

    s.rel(1400, 470, "WORKS_FOR")
    s.line([subs["RECRUITER"], (1400, 470)], double=True)
    C = (1400, 600)
    s.line([(1400, 470), C])
    s.entity(*C, "COMPANY")
    s.card(1418, 400, "N"); s.card(1418, 560, "1")

    U = (1230, 610)
    s.line([(1080, 372), U]); s.line([(1315, 600), U])
    s.circle(*U, "U")
    SP = (1230, 720)
    s.line([U, SP])
    s.entity(*SP, "SPONSOR")
    s.text(1252, 662, "category (union type)", size=12, color=MUTED, anchor="start", italic=True)
    s.rel(1230, 805, "SPONSORS")
    s.line([SP, (1230, 805), (1460, 805)])
    s.entity(1540, 805, "PLACEMENT_CYCLE", w=180)
    s.card(1210, 768, "M"); s.card(1325, 790, "N")

    s.legend(40, 560, [("entity", "Entity"), ("rel", "Relationship"), ("double", "Total participation"),
                       ("key", "Key attribute"), ("multi", "Multi-valued"), ("derived", "Derived"),
                       ("o", "Overlapping specialization"), ("U", "Category (union)")])
    return s.save("eer_people")


# =====================================================================
# EER part 2: the recruitment pipeline
# =====================================================================

def eer_pipeline():
    s = Svg(1640, 900, "EER (2/2): the recruitment pipeline")
    S, A, J = (450, 360), (760, 360), (1070, 360)
    s.box(330, 180, 860, 230, "#f5f3ff", "#7c3aed")
    s.back.append(f'<text x="560" y="205" font-size="12.5" font-weight="700" fill="#6d28d9">'
                  'AGGREGATION: an application is itself evaluated and results in an offer</text>')
    s.line([S, A], double=False); s.line([A, J])
    s.entity(*S, "STUDENT"); s.entity(*J, "JOB_ROLE"); s.rel(*A, "APPLIES_TO")
    s.card(560, 345, "M"); s.card(955, 345, "N")
    s.attr(690, 262, "status", owner=A)
    s.attr(840, 262, "applied_at", owner=A)

    SK = (760, 80)
    s.entity(*SK, "SKILL")
    s.rel(450, 80, "HAS_SKILL"); s.line([S, (450, 80), SK])
    s.attr(450, 140, "proficiency", owner=(450, 80))
    s.rel(1070, 80, "REQUIRES"); s.line([J, (1070, 80), SK])
    s.attr(1070, 140, "min_proficiency", owner=(1070, 80))
    s.card(468, 300, "M"); s.card(655, 64, "N"); s.card(1088, 300, "M"); s.card(865, 64, "N")

    C, PC, PR = (1460, 200), (1460, 360), (1460, 520)
    s.entity(*C, "COMPANY"); s.entity(*PC, "PLACEMENT_CYCLE", w=180); s.entity(*PR, "PROGRAM")
    s.rel(1265, 270, "OFFERS", w=130); s.line([(1155, 345), (1265, 270), C])
    s.rel(1265, 360, "IN_CYCLE", w=130); s.line([(1155, 360), (1265, 360), PC])
    s.rel(1265, 460, "ELIGIBLE_FOR", w=150); s.line([(1155, 375), (1265, 460), PR])
    s.attr(1265, 530, "min_cgpa", owner=(1265, 460))
    s.card(1178, 318, "N"); s.card(1362, 248, "1"); s.card(1180, 346, "N"); s.card(1352, 345, "1")
    s.card(1180, 400, "M"); s.card(1358, 478, "N")

    D = (1070, 495)
    s.line([J, D], double=True)
    s.circle(*D, "d")
    s.text(1095, 495, "disjoint, total", size=12, color=MUTED, anchor="start", italic=True)
    IN, FT = (930, 610), (1210, 610)
    s.line([D, IN]); s.line([D, FT])
    s.entity(*IN, "INTERNSHIP_ROLE", w=180); s.entity(*FT, "FULLTIME_ROLE", w=180)
    s.attr(930, 690, "stipend_monthly", owner=IN)
    s.attr(1210, 690, "ctc_lpa", owner=FT)

    IR = (640, 720)
    s.rel(800, 560, "HAS_ROUND", ident=True)
    s.line([(1020, 383), (800, 560)])
    s.line([(800, 560), IR], double=True)
    s.entity(*IR, "INTERVIEW_ROUND", weak=True, w=190)
    s.attr(560, 805, "round_no", "partial", owner=IR)
    s.attr(735, 805, "round_type", owner=IR)
    s.card(985, 428, "1"); s.card(735, 640, "N")

    s.rel(480, 560, "EVALUATED_IN", w=165)
    s.line([(480, 410), (480, 560), IR])
    for (ax, ay), lbl in zip([(335, 650), (365, 720), (440, 790)], ["slot_start", "result", "score"]):
        s.attr(ax, ay, lbl, owner=(480, 560))
    s.card(498, 440, "M"); s.card(560, 680, "N")

    s.rel(200, 360, "RESULTS_IN")
    s.line([(330, 360), (200, 360)])
    OF = (200, 500)
    s.line([(200, 360), OF], double=True)
    s.entity(*OF, "OFFER", w=140)
    s.attr(80, 590, "status", owner=OF)
    s.attr(150, 690, "response_deadline", owner=OF)
    s.card(300, 345, "1"); s.card(218, 440, "0..1")

    s.legend(1360, 650, [("weak", "Weak entity"), ("rel", "Identifying rel. (double)"),
                         ("d", "Disjoint specialization"), ("double", "Total participation")])
    s.text(1360, 790, "Partial key: dashed underline", size=12.5, anchor="start", color="#334155")
    return s.save("eer_pipeline")


# =====================================================================
# Relational schema, read from the catalog
# =====================================================================

def schema():
    conn = psycopg.connect(host="localhost", dbname="placeiq", user="postgres",
                           password=os.getenv("PGPASSWORD", "postgres"))
    cols = conn.execute("""
        SELECT c.table_name, c.column_name, c.ordinal_position,
               EXISTS (SELECT 1 FROM information_schema.key_column_usage k
                       JOIN information_schema.table_constraints t ON t.constraint_name = k.constraint_name
                            AND t.table_schema = k.table_schema
                       WHERE t.constraint_type = 'PRIMARY KEY' AND k.table_schema = 'placeiq'
                         AND k.table_name = c.table_name AND k.column_name = c.column_name) AS pk,
               EXISTS (SELECT 1 FROM information_schema.key_column_usage k
                       JOIN information_schema.table_constraints t ON t.constraint_name = k.constraint_name
                            AND t.table_schema = k.table_schema
                       WHERE t.constraint_type = 'FOREIGN KEY' AND k.table_schema = 'placeiq'
                         AND k.table_name = c.table_name AND k.column_name = c.column_name) AS fk
        FROM information_schema.columns c WHERE c.table_schema = 'placeiq'
          AND c.table_name IN (SELECT table_name FROM information_schema.tables
                               WHERE table_schema = 'placeiq' AND table_type = 'BASE TABLE')
        ORDER BY c.table_name, c.ordinal_position""").fetchall()
    fks = conn.execute("""
        SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
        FROM pg_constraint WHERE contype = 'f' AND connamespace = 'placeiq'::regnamespace""").fetchall()
    conn.close()

    tables = {}
    for t, c, _, pk, fk in cols:
        tables.setdefault(t, []).append((c, pk, fk))

    W, RH, HH = 222, 18, 28
    pos = {
        "person": (30, 70), "student": (30, 300), "student_skill": (30, 520), "skill": (30, 640), "committee_member": (30, 740),
        "alumnus": (300, 70), "program": (300, 260), "sponsor": (300, 410), "sponsorship": (300, 520), "placement_cycle": (300, 680),
        "company": (570, 70), "recruiter": (570, 290), "placement_log": (570, 410), "eligibility": (570, 580), "job_required_skill": (570, 710),
        "application": (840, 70), "offer": (840, 260), "interview": (840, 470),
        "job_role": (1110, 70), "internship_role": (1110, 300), "fulltime_role": (1110, 440), "interview_round": (1110, 580),
    }
    s = Svg(1370, 880, "Relational schema: 22 tables in BCNF (PK bold, FK italic, arrows point to the referenced table)")

    def rect(t):
        x, y = pos[t]
        return x, y, W, HH + RH * len(tables[t]) + 6

    for child, parent in fks:
        child, parent = child.split(".")[-1], parent.split(".")[-1]
        if child == parent:
            continue
        cx, cy, cw, ch = rect(child)
        px, py, pw, ph = rect(parent)
        if px > cx + cw:
            a, b = (cx + cw, cy + ch / 2), (px, py + 14)
        elif px + pw < cx:
            a, b = (cx, cy + ch / 2), (px + pw, py + 14)
        elif py > cy:
            a, b = (cx + cw * 0.7, cy + ch), (px + pw * 0.7, py)
        else:
            a, b = (cx + cw * 0.3, cy), (px + pw * 0.3, py + ph)
        mx = (a[0] + b[0]) / 2
        if abs(a[0] - b[0]) > 20:
            d = f"M {a[0]},{a[1]} C {mx},{a[1]} {mx},{b[1]} {b[0]},{b[1]}"
        else:
            my = (a[1] + b[1]) / 2
            d = f"M {a[0]},{a[1]} C {a[0]},{my} {b[0]},{my} {b[0]},{b[1]}"
        s.lines.append(f'<path d="{d}" fill="none" stroke="#94a3b8" stroke-width="1.4" opacity="0.85" marker-end="url(#arrow)"/>')

    for t, columns in tables.items():
        x, y, w, h = rect(t)
        s.shapes.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="#ffffff" stroke="{INDIGO}" stroke-width="1.6"/>')
        s.shapes.append(f'<path d="M {x},{y + HH} L {x},{y + 8} Q {x},{y} {x + 8},{y} L {x + w - 8},{y} Q {x + w},{y} {x + w},{y + 8} L {x + w},{y + HH} Z" fill="{INDIGO}"/>')
        s.text(x + 10, y + HH / 2 + 1, t, size=13, weight=700, color="#ffffff", anchor="start")
        for i, (c, pk, fk) in enumerate(columns):
            yy = y + HH + 6 + RH * i + RH / 2
            tag = "PK" if pk else ("FK" if fk else "")
            if tag:
                s.shapes.append(f'<text x="{x + w - 10}" y="{yy}" font-size="10" font-weight="700" '
                                f'fill="{INDIGO if pk else AMBER}" text-anchor="end" dominant-baseline="middle">{tag}{" FK" if pk and fk else ""}</text>')
            s.text(x + 10, yy, c, size=12, weight=700 if pk else 400, color=INK, anchor="start", italic=fk and not pk)
    return s.save("schema")


# =====================================================================
# Normalization
# =====================================================================

def normalization():
    s = Svg(1380, 700, "Normalization: from the placement spreadsheet to BCNF")
    steps = {"UNF": "anomalies: update, insert, delete", "1NF": "split multi-valued {skills}",
             "2NF": "remove partial deps (FD1, FD4, FD5, FD7)", "3NF": "remove transitive deps (FD3, FD6)"}
    cols = [
        ("UNF: spreadsheet", 30, [("PLACEMENT_SHEET", "roll_no, name, email, prog_code, prog_name, cgpa, {skills}, company, sector, hq_city, cycle, job_title, role_type, pay, min_cgpa, round_no, round_type, slot, result, app_status")]),
        ("1NF: atomic values", 360, [("STUDENT_SKILL", "roll_no, skill"),
                                     ("SHEET_1NF", "roll_no, company, cycle, job_title, round_no + 15 non-key attributes")]),
        ("2NF: no partial dependency", 690, [("STUDENT", "roll_no, name, email, prog_code, prog_name, cgpa"), ("COMPANY", "company, sector, hq_city"),
                                             ("JOB", "company, cycle, job_title, role_type, pay"), ("ROUND", "J, round_no, round_type"),
                                             ("APPLICATION", "roll_no, J, app_status, min_cgpa"), ("INTERVIEW", "roll_no, J, round_no, slot, result")]),
        ("3NF = BCNF: no transitive dependency", 1020, [("STUDENT", "roll_no, name, email, prog_code, cgpa"), ("PROGRAM", "prog_code, prog_name"),
                                                        ("COMPANY", "company, sector, hq_city"), ("JOB", "J, role_type, pay"),
                                                        ("ELIGIBILITY", "J, prog_code, min_cgpa"), ("ROUND", "J, round_no, round_type"),
                                                        ("APPLICATION", "roll_no, J, app_status"), ("INTERVIEW", "roll_no, J, round_no, slot, result")]),
    ]
    widths = [300, 300, 300, 330]
    for (title, x, rels), w in zip(cols, widths):
        s.text(x + w / 2, 76, title, size=15, weight=700, color=INDIGO)
        s.text(x + w / 2, 98, steps[title.split(":")[0].split(" ")[0]], size=12, color=MUTED, italic=True)
        y = 120
        for name, attrs in rels:
            words, line_, lines = attrs.split(" "), "", []
            for wd in words:
                if len(line_) + len(wd) > 40:
                    lines.append(line_); line_ = wd
                else:
                    line_ = (line_ + " " + wd).strip()
            lines.append(line_)
            h = 34 + 17 * len(lines)
            fill = "#fef2f2" if title.startswith("UNF") else (GREEN_SOFT if title.startswith("3NF") else INDIGO_SOFT)
            stroke = "#dc2626" if title.startswith("UNF") else (GREEN if title.startswith("3NF") else INDIGO)
            s.box(x, y, w, h, fill, stroke, rx=10, back=False)
            s.text(x + 12, y + 17, name, size=13, weight=700, anchor="start", color=stroke)
            for i, ln in enumerate(lines):
                s.text(x + 12, y + 38 + 17 * i, ln, size=11.5, anchor="start", color="#334155")
            y += h + 10
    for x in (333, 663, 993):
        s.line([(x, 150), (x + 24, 150)], color=MUTED, width=2.2, arrow=True)
    s.text(30, 640, "Every split X→Y produces (X∪Y) and (R−Y), with X a key of the first part, so it is lossless (Heath's theorem). "
           "FD1–FD9 each remain inside one table, so it is dependency-preserving.", size=13, color="#334155", anchor="start")
    s.text(30, 668, "J = (company, cycle, job_title), later replaced by the surrogate job_id; the natural key stays UNIQUE.",
           size=12.5, color=MUTED, anchor="start")
    return s.save("normalization")


# =====================================================================
# Architecture
# =====================================================================

def architecture():
    s = Svg(1500, 760, "System architecture")
    s.box(40, 70, 1420, 130, "#f8fafc", "#cbd5e1", label="PRESENTATION: browser single-page app (HTML, CSS, vanilla JS)", label_color="#334155")
    for i, t in enumerate(["Dashboard", "Students", "Jobs", "SQL analytics", "Injection lab", "Audit log"]):
        x = 70 + i * 228
        s.box(x, 110, 205, 64, "#ffffff", INDIGO, rx=10, back=False)
        s.text(x + 102, 142, t, size=14, weight=600, color="#1e1b4b")
    s.line([(750, 200), (750, 245)], color=MUTED, width=2, arrow=True)
    s.text(765, 222, "JSON over HTTP (fetch)", size=12, anchor="start", color=MUTED)

    s.box(40, 250, 1420, 140, "#f8fafc", "#cbd5e1", label="APPLICATION: FastAPI REST API (app/main.py), bound to 127.0.0.1", label_color="#334155")
    for i, (t, sub) in enumerate([("REST endpoints", "/api/students, /jobs, /offers ..."), ("Parameterised SQL", "psycopg 3, %s placeholders"),
                                  ("Error translator", "SQLSTATE + raising trigger"), ("Swagger docs", "/docs")]):
        x = 70 + i * 345
        s.box(x, 290, 320, 78, "#ffffff", AMBER, rx=10, back=False)
        s.text(x + 160, 318, t, size=14, weight=700, color="#7c2d12")
        s.text(x + 160, 344, sub, size=12, color=MUTED)
    s.line([(750, 390), (750, 435)], color=MUTED, width=2, arrow=True)
    s.text(765, 412, "SQL: SELECT, CALL, fn_apply_for_job(...)", size=12, anchor="start", color=MUTED)

    s.box(40, 440, 1420, 290, "#f0fdfa", GREEN, label="DATA: PostgreSQL 18, database placeiq, schema placeiq", label_color=GREEN)
    items = [("22 tables", "BCNF, PK / FK / CHECK / EXCLUDE"), ("2 views", "v_job_details, v_placement_status"),
             ("9 triggers", "eligibility, one-offer policy, totality"), ("3 routines", "fn_apply_for_job, sp_accept_offer, sp_expire_stale_offers"),
             ("Indexes", "FK indexes, partial index on accepted offers"), ("Role placeiq_readonly", "least privilege for the injection lab")]
    for i, (t, sub) in enumerate(items):
        x = 70 + (i % 3) * 460
        y = 480 + (i // 3) * 120
        s.box(x, y, 430, 96, "#ffffff", GREEN, rx=10, back=False)
        s.text(x + 215, y + 34, t, size=15, weight=700, color="#134e4a")
        s.text(x + 215, y + 62, sub, size=12, color=MUTED)
    return s.save("architecture")


# =====================================================================
# Trigger flow
# =====================================================================

def trigger_flow():
    s = Svg(1500, 860, "Accepting an offer: one transaction, three layers of protection")
    steps = [
        (90, "CALL sp_accept_offer(offer_id)", "stored procedure", INDIGO, INDIGO_SOFT),
        (190, "Lock the student row (SELECT ... FOR UPDATE)", "concurrent acceptances for the same student queue here", INDIGO, INDIGO_SOFT),
        (290, "Re-read the offer under the lock: still PENDING?", "else: raise 'only a PENDING offer can be accepted'", INDIGO, INDIGO_SOFT),
        (390, "UPDATE offer SET status = 'ACCEPTED'", "fires the triggers below", INDIGO, INDIGO_SOFT),
        (490, "BEFORE trigger: trg_offer_accept_guard", "deadline not passed? no other ACCEPTED offer in this cycle?", AMBER, AMBER_SOFT),
        (590, "AFTER trigger: trg_offer_accept_cascade", "runs in the SAME transaction", AMBER, AMBER_SOFT),
    ]
    for y, title, sub, stroke, fill in steps:
        s.box(80, y - 36, 640, 74, fill, stroke, rx=12, back=False)
        s.text(110, y - 10, title, size=15, weight=700, anchor="start", color=INK)
        s.text(110, y + 15, sub, size=12.5, anchor="start", color=MUTED)
    for y in (126, 226, 326, 426, 526):
        s.line([(400, y + 2), (400, y + 26)], color=MUTED, width=2, arrow=True)
    effects = ["1. Decline the student's other PENDING offers in the cycle",
               "2. Withdraw their open applications in the cycle",
               "3. Delete their SCHEDULED interviews for other jobs",
               "4. Write OFFER_ACCEPTED / AUTO_* rows to placement_log"]
    s.line([(720, 590), (790, 590)], color=MUTED, width=2, arrow=True)
    s.box(800, 470, 640, 240, GREEN_SOFT, GREEN, rx=12, back=False)
    s.text(830, 500, "Cascade (inside the same transaction)", size=15, weight=700, anchor="start", color=GREEN)
    for i, e in enumerate(effects):
        s.text(830, 545 + i * 38, e, size=13.5, anchor="start", color="#134e4a")
    s.box(80, 680, 640, 130, "#fef2f2", "#dc2626", rx=12, back=False)
    s.text(110, 712, "Atomicity", size=15, weight=700, anchor="start", color="#b91c1c")
    s.text(110, 742, "COMMIT keeps everything; any error or ROLLBACK undoes every step,", size=13, anchor="start", color="#7f1d1d")
    s.text(110, 766, "including the cascade. The student never ends up half-placed.", size=13, anchor="start", color="#7f1d1d")
    s.text(110, 790, "Verified by tests TC-TXN-01 to TC-TXN-03.", size=12.5, anchor="start", color=MUTED)
    s.box(800, 90, 640, 330, "#f8fafc", "#cbd5e1", rx=12, back=False)
    s.text(830, 122, "Why the lock order matters (concurrency)", size=15, weight=700, anchor="start", color=INK)
    lines = ["Session A and B accept two offers for the SAME student.",
             "Both lock the student row first, so B waits for A.",
             "A commits, and its trigger has already DECLINED B's offer.",
             "B wakes up, re-reads its offer, sees DECLINED, and aborts.",
             "Result: exactly one accepted offer. Never two.",
             "",
             "Locking the offer row first could deadlock: each session",
             "holds one offer that the other's cascade needs."]
    for i, ln in enumerate(lines):
        s.text(830, 162 + i * 30, ln, size=13.5, anchor="start", color="#334155" if i < 5 else MUTED)
    return s.save("trigger_flow")


# =====================================================================

def render(svg_path: Path):
    text = svg_path.read_text(encoding="utf-8")
    w = int(float(text.split('width="', 1)[1].split('"', 1)[0]))
    h = int(float(text.split('height="', 1)[1].split('"', 1)[0]))
    png = svg_path.with_suffix(".png")
    page = svg_path.with_suffix(".html")
    page.write_text(f'<html><body style="margin:0">{text}</body></html>', encoding="utf-8")
    profile = OUT / ".edge-profile"
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                    f"--user-data-dir={profile}", "--force-device-scale-factor=2",
                    f"--window-size={w},{h}", f"--screenshot={png}", page.as_uri()],
                   capture_output=True, timeout=120)
    page.unlink()
    return png


if __name__ == "__main__":
    for build in (eer_people, eer_pipeline, schema, normalization, architecture, trigger_flow):
        path = build()
        print("rendered", render(path).name)
