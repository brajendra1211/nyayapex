"""Text extraction from PDF / DOCX. Zero tokens - pure Python."""

from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz

try:
    import pytesseract
    from PIL import Image

    pytesseract.get_tesseract_version()
    OCR_AVAILABLE = True
except Exception:  # binary not installed
    OCR_AVAILABLE = False

MIN_TEXT_CHARS = 40  # below this a PDF page is treated as scanned
DOCX_CHARS_PER_PAGE = 2800


@dataclass
class Page:
    number: int  # 1-indexed
    text: str
    ocr: bool = False

    def __post_init__(self):
        self.text = self.text.replace("\x00", "")  # some PDFs carry NUL characters, which PostgreSQL text cannot store


def extract_pages(path: Path) -> list[Page]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf(path)
    if suffix == ".docx":
        return _extract_docx(path)
    if suffix == ".txt":
        return _split_text(path.read_text(encoding="utf-8", errors="ignore"))
    raise ValueError(f"Unsupported file type: {suffix}")


def _extract_pdf(path: Path) -> list[Page]:
    pages: list[Page] = []
    with fitz.open(path) as doc:
        for i, page in enumerate(doc, start=1):
            text = page.get_text("text")
            if len(text.strip()) < MIN_TEXT_CHARS and OCR_AVAILABLE:
                pix = page.get_pixmap(dpi=250)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                text = pytesseract.image_to_string(img, lang="eng")
                pages.append(Page(i, text, ocr=True))
            else:
                pages.append(Page(i, text))
    return pages


def extract_pdf_bytes(data: bytes) -> list[Page]:
    """Born-digital PDFs held in memory (public judgments) - no temp file, no OCR."""
    with fitz.open(stream=data, filetype="pdf") as doc:
        return [Page(i, page.get_text("text")) for i, page in enumerate(doc, start=1)]


def _extract_docx(path: Path) -> list[Page]:
    import docx

    document = docx.Document(str(path))
    text = "\n".join(p.text for p in document.paragraphs)
    return _split_text(text)


def _split_text(text: str) -> list[Page]:
    pages, buf, n = [], [], 1
    size = 0
    for line in text.splitlines():
        buf.append(line)
        size += len(line)
        if size >= DOCX_CHARS_PER_PAGE:
            pages.append(Page(n, "\n".join(buf)))
            buf, size, n = [], 0, n + 1
    if buf:
        pages.append(Page(n, "\n".join(buf)))
    return pages
