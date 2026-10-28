"""
Records the PlaceIQ demo: drives the real UI in headless Edge, adds captions,
saves a screenshot per step and a backup video.

Requires the web app running on http://127.0.0.1:8000.
    app\\.venv\\Scripts\\python deliverables\\src\\record_demo.py

Outputs:
  deliverables/screenshots/demo_NN_<step>.png
  deliverables/PlaceIQ_Demo_Video.webm
  deliverables/screenshots/demo_steps.json   (captions, for the runbook)
"""

import json
import shutil
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"
VIDEO_TMP = ROOT / ".video-tmp"
SHOTS.mkdir(exist_ok=True)

CAPTION_JS = """
(text) => {
  let el = document.getElementById('demo-caption');
  if (!el) {
    el = document.createElement('div');
    el.id = 'demo-caption';
    el.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;' +
      'max-width:980px;padding:10px 18px;border-radius:12px;background:rgba(17,24,39,.92);color:#fff;' +
      'font:600 15px Segoe UI,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = text;
}
"""

steps = []


def api(method, path):
    req = urllib.request.Request(BASE + path, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    api("POST", "/api/admin/reset")
    offer_19 = next(a["offer_id"] for a in api("GET", "/api/students/PGP62-084")["applications"] if a["job_id"] == 19)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1,
                                      record_video_dir=str(VIDEO_TMP), record_video_size={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("dialog", lambda d: d.accept())

        def caption(text):
            page.evaluate(CAPTION_JS, text)

        def shot(name, text, wait=2.5):
            caption(text)
            time.sleep(wait)
            n = len(steps) + 1
            path = SHOTS / f"demo_{n:02d}_{name}.png"
            page.screenshot(path=str(path))
            steps.append({"n": n, "name": name, "caption": text, "file": path.name})

        def go(hash_):
            page.goto(f"{BASE}/{hash_}")
            page.wait_for_load_state("networkidle")
            time.sleep(0.8)

        # 1. dashboard
        go("#/dashboard")
        shot("dashboard", "PlaceIQ dashboard: every number is computed live by SQL views, aggregates and window functions", 3.5)

        # 2. students search
        go("#/students")
        page.fill("#f-q", "")
        page.type("#f-q", "Saxena", delay=90)
        time.sleep(1.2)
        shot("students", "Students: placement status is never stored, it is derived by the view v_placement_status")

        # 3. profile before
        go("#/student/PGP62-084")
        shot("profile_before", "Dev Saxena (PGP62-084): a pending DataSutra offer, and shortlisted for two December interviews", 3.5)

        # 4. recruiter makes a second offer
        go("#/job/21")
        page.locator('button[data-action="make-offer"][data-roll="PGP62-084"]').scroll_into_view_if_needed()
        caption("Monsoon Foods makes a pre-placement offer. Trigger T2 marks the application OFFERED")
        time.sleep(1.5)
        page.click('button[data-action="make-offer"][data-roll="PGP62-084"]')
        time.sleep(1.2)
        shot("second_offer", "Monsoon Foods makes a pre-placement offer. Trigger T2 marks the application OFFERED", 2)

        # 5. accept DataSutra
        go("#/student/PGP62-084")
        caption("Dev now holds two pending offers. Accepting one calls CALL sp_accept_offer(...)")
        time.sleep(2.5)
        page.click(f'button[data-action="accept"][data-offer="{offer_19}"]')
        time.sleep(1.5)
        shot("accept_cascade", "One transaction: the other offer is auto-DECLINED, the open application WITHDRAWN, interview slots freed", 4)

        # 6. placed student tries to apply
        page.select_option("#apply-job", "25")
        page.click('button[data-action="apply"]')
        time.sleep(1.2)
        shot("placed_rejected", "Now placed, so the eligibility trigger refuses any further application in this cycle", 3.5)

        # 7. ineligible student
        go("#/student/PGP62-022")
        page.select_option("#apply-job", "25")
        page.click('button[data-action="apply"]')
        time.sleep(1.2)
        shot("cgpa_rejected", "CGPA 6.23 is below job 25's cut-off of 6.50: rejected by fn_check_application_eligibility()", 3.5)

        # 8. talent match apply
        go("#/job/25")
        page.locator('button[data-action="apply-direct"][data-roll="DBA12-039"]').scroll_into_view_if_needed()
        caption("Talent match = Query 2 (relational division): students holding EVERY required skill")
        time.sleep(2.5)
        page.click('button[data-action="apply-direct"][data-roll="DBA12-039"]')
        time.sleep(1.2)
        shot("talent_apply", "Tanvi (DBA12-039) passes every eligibility check, so the application is accepted", 3)

        # 9. analytics
        go("#/analytics")
        page.click('button[data-action="run-query"][data-query="1"]')
        time.sleep(1.2)
        page.locator("#q-result-1").scroll_into_view_if_needed()
        shot("analytics", "SQL analytics: the five queries run live from 05_queries.sql, read-only", 3)

        # 10. injection lab
        go("#/security")
        page.locator("button.preset").nth(1).click()
        page.click('button[data-action="inj"][data-mode="unsafe"]')
        page.click('button[data-action="inj"][data-mode="safe"]')
        time.sleep(1.5)
        shot("injection", "Same input: string concatenation leaks all 180 students; the bound parameter returns 0", 4)
        page.locator("button.preset").nth(3).click()
        page.click('button[data-action="inj"][data-mode="unsafe"]')
        time.sleep(1.2)
        shot("injection_drop", "DROP TABLE attempt: blocked by the read-only transaction and the least-privilege role", 3.5)

        # 11. audit log
        go("#/activity")
        shot("audit_log", "Audit log: every row was written by the trigger, not by application code", 3)

        # 12. reset
        go("#/dashboard")
        caption("Reset demo data rebuilds the database in about a second, so the demo can be repeated")
        time.sleep(1.5)
        page.click('button[data-action="reset"]')
        time.sleep(3)
        shot("reset", "Reset demo data rebuilds the database in about a second, so the demo can be repeated", 2)

        video_path = page.video.path()
        context.close()
        browser.close()

    target = ROOT / "PlaceIQ_Demo_Video.webm"
    shutil.move(video_path, target)
    shutil.rmtree(VIDEO_TMP, ignore_errors=True)
    (SHOTS / "demo_steps.json").write_text(json.dumps(steps, indent=2), encoding="utf-8")
    print(f"{len(steps)} steps, video {target.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
