from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

EMAIL = re.compile(r"(?<![\w.-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}", re.I)
PHONE = re.compile(r"(?:\+\d{1,3}[ -]?)?(?:\(?\d{2,4}\)?[ -]?)?\d{6,12}")
URL = re.compile(r"(?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:/[\w./?=&%-]*)?", re.I)


def _tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


def extract_text_from_image(image_path: str) -> str:
    if not _tesseract_available():
        raise RuntimeError("Tesseract OCR is not installed or is not available on PATH.")
    import pytesseract
    from PIL import Image

    with Image.open(image_path) as image:
        return pytesseract.image_to_string(image, config="--psm 6")


def parse_phone(value: str) -> str:
    return re.sub(r"[^\d+]", "", value)


def extract(text: str) -> dict[str, Any]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    emails = list(dict.fromkeys(match.group(0) for match in EMAIL.finditer(text)))
    phones = list(dict.fromkeys(parse_phone(match.group(0)) for match in PHONE.finditer(text)))
    urls = list(dict.fromkeys(match.group(0) for match in URL.finditer(text) if "@" not in match.group(0)))
    institution_markers = re.compile(r"\b(university|college|school|academy|institute|foundation|technologies|services|pvt|limited|llp)\b", re.I)
    institution = next((line for line in lines if institution_markers.search(line)), None)
    titles = re.compile(r"\b(Director|Principal|Dean|HOD|Head|Manager|Officer|Founder|Chairman|Faculty|HR|Recruiter|Administrator)\b", re.I)
    designation = next((match.group(0) for line in lines for match in titles.finditer(line)), None)
    remaining = [line for line in lines if line not in (institution, designation)]
    name = remaining[0] if remaining and not EMAIL.search(remaining[0]) and not URL.search(remaining[0]) else None
    fields = {
        "full_name": name,
        "designation": designation,
        "institution": institution,
        "email": emails[0] if emails else None,
        "mobile": phones[0] if phones else None,
        "alternate_phone": phones[1] if len(phones) > 1 else None,
        "website": urls[0] if urls else None,
    }
    fields = {key: value for key, value in fields.items() if value}
    return {
        "fields": fields,
        "confidences": {key: "medium" if key in {"full_name", "institution", "designation"} else "high" for key in fields},
        "sources": {key: "OCR" for key in fields},
        "conflicts": [],
    }


def merge(front_text: str, back_text: str) -> dict:
    front = extract(front_text)
    back = extract(back_text)
    merged: dict[str, Any] = {}
    confidences: dict[str, str] = {}
    sources: dict[str, str] = {}
    conflicts: list[dict[str, str]] = []
    for field in set(front["fields"]) | set(back["fields"]):
        front_value = front["fields"].get(field)
        back_value = back["fields"].get(field)
        if front_value and back_value and front_value != back_value:
            conflicts.append({"field": field, "front": front_value, "back": back_value})
        value = front_value or back_value
        if value:
            merged[field] = value
            confidences[field] = front["confidences"].get(field, back["confidences"].get(field, "medium"))
            sources[field] = "front" if front_value and back_value is None else "back" if back_value and front_value is None else "front+back"
    return {"fields": merged, "confidences": confidences, "sources": sources, "conflicts": conflicts}
