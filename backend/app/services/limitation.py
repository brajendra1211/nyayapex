"""Limitation calculator - pure date arithmetic, zero tokens.

Periods follow the Limitation Act, 1963 and SC Rules, 2013 as commonly applied.
Every result shows its working so the advocate can verify it; court vacations and
holidays (Sec. 4) are NOT known to this calculator and are flagged instead.
"""

from datetime import date, timedelta

PERIODS = {
    "slp_judgment": {"days": 90, "label": "SLP against judgment/order (Art. 136)", "basis": "Limitation Act, Sch. Art. 133(c); SC Rules 2013, O. XXII r. 2"},
    "slp_certificate_refused": {"days": 60, "label": "SLP after refusal of certificate by High Court", "basis": "Limitation Act, Sch. Art. 133(b)"},
    "civil_appeal_certificate": {"days": 60, "label": "Appeal on certificate (Art. 133/134A)", "basis": "Limitation Act, Sch. Art. 132"},
    "review": {"days": 30, "label": "Review petition", "basis": "SC Rules 2013, O. XLVII r. 1"},
    "writ_32": {"days": None, "label": "Writ petition under Art. 32", "basis": "No statutory limitation; delay/laches may still be raised"},
}


def calculate(kind: str, order_date: date, copy_applied: date | None = None, copy_ready: date | None = None,
              filing_date: date | None = None) -> dict:
    if kind not in PERIODS:
        raise ValueError(f"Unknown limitation type: {kind}")
    rule = PERIODS[kind]
    steps = [f"Order / judgment dated {order_date:%d %b %Y}. Day of the order is excluded (Sec. 12(1))."]

    if rule["days"] is None:
        return {"kind": kind, "label": rule["label"], "basis": rule["basis"], "last_date": None,
                "steps": steps + [rule["basis"]], "status": "NO FIXED PERIOD", "warnings": []}

    last = order_date + timedelta(days=rule["days"])
    steps.append(f"Add {rule['days']} days → {last:%d %b %Y}.")

    excluded = 0
    if copy_applied and copy_ready and copy_ready >= copy_applied:
        excluded = (copy_ready - copy_applied).days + 1
        last += timedelta(days=excluded)
        steps.append(
            f"Exclude certified-copy time {copy_applied:%d %b %Y} → {copy_ready:%d %b %Y} = {excluded} days (Sec. 12(2)) → {last:%d %b %Y}."
        )

    warnings = ["If the last date falls on a day the Court/Registry is closed, filing on the next working day is valid (Sec. 4) - check the SC calendar."]
    if last.weekday() >= 5:
        warnings.insert(0, f"{last:%d %b %Y} is a {last:%A}.")

    result = {"kind": kind, "label": rule["label"], "basis": rule["basis"], "last_date": last.isoformat(),
              "excluded_days": excluded, "steps": steps, "warnings": warnings}

    ref = filing_date or date.today()
    delay = (ref - last).days
    if delay > 0:
        result["status"] = "TIME-BARRED"
        result["delay_days"] = delay
        steps.append(f"Filing on {ref:%d %b %Y} is {delay} day(s) late → application for condonation of delay (Sec. 5) required.")
    else:
        result["status"] = "WITHIN LIMITATION"
        result["days_left"] = -delay
    return result
