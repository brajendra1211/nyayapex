from dataclasses import dataclass

from .extract import Page

TARGET_WORDS = 900


@dataclass
class ChunkData:
    idx: int
    page_start: int
    page_end: int
    text: str


def chunk_pages(pages: list[Page], target_words: int = TARGET_WORDS) -> list[ChunkData]:
    chunks: list[ChunkData] = []
    buf: list[str] = []
    words = 0
    start = pages[0].number if pages else 1
    last = start
    for p in pages:
        if not buf:
            start = p.number
        buf.append(f"[p.{p.number}]\n{p.text}")
        words += len(p.text.split())
        last = p.number
        if words >= target_words:
            chunks.append(ChunkData(len(chunks), start, last, "\n".join(buf)))
            buf, words = [], 0
    if buf:
        chunks.append(ChunkData(len(chunks), start, last, "\n".join(buf)))
    return chunks
