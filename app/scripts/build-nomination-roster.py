#!/usr/bin/env python3
"""Extract employee/HoD identities from the supplied workbook, without guessing emails.

Names are compared only within this workbook to find the HoD's employee row.
Runtime authorization must use the resulting exact email and a verified SSO claim.
Unresolved HoDs retain a null email and cannot receive submissions.
"""
import argparse
import collections
import json
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
# Explicit identity equivalence confirmed by the user; email still comes from the workbook.
HOD_NAME_ALIASES = {"GAO Xiaohan": "Gao-Urhahn Xiaohan"}
# Missing workbook emails explicitly supplied by the user on 2026-10-28.
HOD_EMAIL_OVERRIDES = {"Appukuttan Pillai Vinod": "vio2kor@bosch.com"}
EMPLOYEE_EMAIL_OVERRIDES = {"Ms. 陈培艺/CHEN Peiyi": "cpy8sgh@bosch.com"}
# Explicit self-review test identity confirmed by the user on 2026-10-28.
# Missing display fields are read from the signed-in profile, not inferred here.
SELF_REVIEW_TEST_EMAIL = "fixed-term.yaolong.zhang@cn.bosch.com"


def identity_name(value):
    english = value.rsplit("/", 1)[-1]
    ascii_name = unicodedata.normalize("NFKD", english).encode("ascii", "ignore").decode()
    return tuple(sorted(token for token in re.findall(r"[a-z0-9]+", ascii_name.lower())
                        if token not in {"mr", "ms", "mrs", "dr"}))


def read_rows(path):
    with zipfile.ZipFile(path) as archive:
        strings = ["".join(node.itertext()) for node in
                   ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        rows = []
        for row in ET.fromstring(archive.read("xl/worksheets/sheet1.xml")).findall(".//m:sheetData/m:row", NS):
            cells = {}
            for cell in row:
                value = cell.find("m:v", NS)
                text = value.text if value is not None else ""
                if cell.get("t") == "s":
                    text = strings[int(text)]
                elif cell.get("t") == "inlineStr":
                    text = "".join(cell.itertext())
                cells[re.sub(r"\d", "", cell.attrib["r"])] = text.strip()
            rows.append(cells)
    expected = {"B": "Formatted Name", "D": "Org Unit", "E": "Nominating HoD", "H": "Email", "I": "NT"}
    if not rows or any(rows[0].get(key) != value for key, value in expected.items()):
        raise ValueError("Unexpected employee workbook columns")
    return [row for row in rows[1:] if any(row.values())]


def build_roster(rows):
    rows = [dict(row) for row in rows]
    for name, email in EMPLOYEE_EMAIL_OVERRIDES.items():
        matches = [row for row in rows if row.get("B") == name]
        if len(matches) != 1 or matches[0].get("H", "").lower() not in {"", email}:
            raise ValueError("Confirmed employee email does not uniquely match the workbook")
        matches[0]["H"] = email
    emails = [row.get("H", "").lower() for row in rows]
    if any(email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) for email in emails):
        raise ValueError("Invalid employee email")
    known_emails = [email for email in emails if email]
    if len(set(known_emails)) != len(known_emails):
        raise ValueError("Ambiguous duplicate employee email")
    result = []
    for row in rows:
        source_head = row.get("E", "")
        # The user confirmed N/A means this employee is the HoD and may self-approve.
        self_approval = source_head == "N/A"
        head = row.get("B", "") if self_approval else HOD_NAME_ALIASES.get(source_head, source_head)
        head_key = identity_name(head) if head else ()
        matches = [other for other in rows if head_key and identity_name(other.get("B", "")) == head_key]
        nt_matches = {other.get(nt, "") for other in rows
                      for name, nt in (("B", "I"), ("K", "J"), ("N", "M"))
                      if head_key and identity_name(other.get(name, "")) == head_key and other.get(nt)}
        if len(matches) > 1 or len(nt_matches) > 1:
            raise ValueError("Ambiguous HoD identity in workbook")
        result.append({
            "email": row["H"].lower(), "nt": row.get("I", ""),
            "name": row.get("B", ""), "orgUnit": row.get("D", ""),
            "nominatingHead": head,
            "allowSelfApproval": self_approval,
            "hodNt": next(iter(nt_matches)) if nt_matches else None,
            "hodEmail": (matches[0]["H"].lower() if len(matches) == 1 and matches[0].get("H")
                         else HOD_EMAIL_OVERRIDES.get(head)),
        })
    if any(row["email"] == SELF_REVIEW_TEST_EMAIL for row in result):
        raise ValueError("Self-review test identity now exists in workbook; reconcile its assignment explicitly")
    result.append({
        "email": SELF_REVIEW_TEST_EMAIL, "nt": "", "name": "", "orgUnit": "",
        "nominatingHead": SELF_REVIEW_TEST_EMAIL, "allowSelfApproval": True,
        "hodNt": None, "hodEmail": SELF_REVIEW_TEST_EMAIL,
    })
    return result


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=root / "data/EE_List_BD.xlsx")
    parser.add_argument("--output", type=Path,
                        default=root / "hackhub-api/src/main/resources/nomination-roster.json")
    args = parser.parse_args()
    roster = build_roster(read_rows(args.input))
    args.output.write_text(json.dumps(roster, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    unresolved = collections.Counter(row["nominatingHead"] for row in roster if not row["hodEmail"])
    print(json.dumps({"employees": len(roster), "resolvedEmployees": sum(bool(row["email"] and row["hodEmail"]) for row in roster),
                      "missingEmployeeEmails": sum(not row["email"] for row in roster),
                      "unresolvedHoDs": unresolved}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
