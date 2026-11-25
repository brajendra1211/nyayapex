# Nyay Apex

AI-powered practice platform for Supreme Court of India advocates (see `Nyay_apex_PRD_Final.pdf`).

```
frontend/   Next.js 16 + Tailwind 4 — the panel (dashboard, research, drafting, compliance, cases …)
backend/    Python FastAPI — document analysis + the only place that talks to Claude
```

## Run locally

**Backend** (terminal 1)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env            # then put your ANTHROPIC_API_KEY in .env
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

**Frontend** (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Without an API key everything that is pure Python still works
(chronology, citations, format check, limitation, precedent check, cases); AI features show a clear message.

Optional OCR for scanned PDFs: install the Tesseract binary (Windows: UB-Mannheim build) and make sure `tesseract` is on PATH.

## Login & accounts

Login is WhatsApp OTP via abwpl.com (`backend/app/services/otp.py`). Set in `backend/.env`:

| Variable | Purpose |
|---|---|
| `WHATSAPP_OTP_API_KEY` | abwpl.com API key (sent as `X-API-Key`) |
| `JWT_SECRET` | Long random secret for session tokens (auto-generated into `.env` for dev) |
| `PLATFORM_ADMIN_PHONES` | Comma-separated numbers that can approve Bar / student verifications at `/admin` |
| `OTP_DEV_BYPASS` | **Dev only** — accepts code `123456` without sending WhatsApp. Keep `false` in production |

Account types (chosen once during onboarding): **Individual Advocate**, **Law Firm / Chamber** (roles: Admin, AOR,
Senior, Junior, Clerk), **Corporate Legal Team** (Admin, General Counsel, Counsel, Paralegal), **Law Student**
(no cases/courtroom; drafts watermarked "TRAINING DRAFT"). Firm/corporate admins invite members by mobile number at
**Team & Roles**; invitees join when they first log in. Every case, document, citation and AI-usage row belongs to one
workspace and is never visible to another. Onboarding records DPDP consent and the AI-is-advisory acknowledgement
(see `docs/sc-ai-regulations-2026.md`).

> Schema changed with accounts: delete `backend/nyay.db` once when upgrading a dev database.

## Matters, team & client portal

Each case has a **matter workspace** at `/matter?id=…` with these tabs:

- **Overview**: matter details, team (lead / member) and client access.
- **Team discussion**: internal and privileged. Clients never see it. Type `@name` to notify someone.
- **Client**: a separate channel with the client.
- **Documents**: each document is *internal* until someone explicitly shares it with the client.
- **Tasks / requests**: assign work to a team member, or ask the client for a document.
- **References**: use *Save to matter* on Research results.
- **Activity**: the audit log.

**Who sees what**

- **AOR, Senior, Admin, GC, Counsel**: every matter in the account.
- **Juniors, clerks, paralegals**: only the matters they are added to. The admin can change this on *Team & Roles → Matter visibility*.
- **Clients**: invited from a matter by mobile number or email. They sign in to a separate portal (`/portal`) that shows only their matters:
  - next hearing and stage
  - documents shared with them
  - requests, which they answer by uploading
  - a chat with the advocate

  Client uploads are processed without AI.

**Notifications** appear in-app (bell icon). Hearing-date changes, task assignments, client requests, @mentions and
client messages are also sent on **WhatsApp** when `WHATSAPP_NOTIFY_TEMPLATE` names an approved abwpl template that takes
two parameters: name and update text. Messages carry no privileged content, only "there is an update, open Nyay Apex".

## Filing package (SLP paper-book) & AI accountability

Open a matter → **Filing** tab → *New SLP (Civil) paper-book*. The wizard (`/filing?id=…`) has four steps:

1. **Details** – parties (pre-filled from the matter title), High Court, case below, date of judgment, what it held,
   deponent, I.A.s (exemption from certified copy / stay / condonation of delay, pre-ticked if limitation has expired),
   annexures (pre-filled from the matter's PDFs).
2. **Petition text** – synopsis, list of dates (pre-filled from the record chronology), questions of law, grounds,
   prayers, delay explanation. *Draft with AI* (Opus, ≈ $0.05) writes only the narrative sections; prayers, affidavit,
   certificate and I.A. text are fixed templates (`services/filing_templates.py`) and never AI-written.
3. **Verify & approve** – citation check against the library, the advocate's checklist (every tick is logged), and
   approval by the AOR / senior / matter lead. Any edit after approval withdraws it and bumps the version.
4. **Export** – paper-book `.docx` (index with page refs, listing proforma, synopsis, petition, certificate,
   affidavit, I.A.s, AI-use declaration when AI was used, vakalatnama, memo of appearance) and an annexures PDF stamped
   "ANNEXURE P-n" with page numbers. Unapproved exports carry a *DRAFT — NOT VERIFIED* header.

SC AI Regulations 2026 (draft) features: AI-use declaration in the filing (Reg 43), audit trail of every AI draft,
edit, check, approval and export (`audit_events`), verification gate before a clean export (Reg 8), and a
**Report AI issue** button on research, briefs, document Q&A, drafting, courtroom and filing answers; reports are
reviewed under *Admin → AI incident reports* (Reg 39).

**Final paper-book PDF** – in step 4, upload the PDF saved from the finished Word file (or, on a server with
LibreOffice, let it convert). The copy of the impugned judgment (picked in step 1) and the annexure PDFs are spliced in at
their places, a new index is built with the real page numbers, all pages are numbered and bookmarked, and the Registry
format check runs on the result.

**Compilation of judgments** – Matter → *References* tab → *Compilation of judgments*: tick saved judgments / matter
PDFs in order, give the relied pages and the passages to highlight, and download one PDF (cover, index, official copies
fetched from the judgment source and cached, relied pages marked, passages highlighted, bookmarks). No AI, no cost.

**AI accountability (SC AI Regulations 2026, draft)**

| Regulation | In Nyay Apex |
|---|---|
| Reg 8(3) verify AI output | "I have verified this" on every AI answer (name + time); filing approval gate |
| Reg 9 auditability | **AI Register** (`/ai-log`, table `ai_outputs`): every AI answer with question, model, sources, who asked, who verified; CSV export |
| Reg 10 / 48 data minimisation | Phone, e-mail, Aadhaar, PAN masked before text reaches the AI provider and restored locally (`services/pii.py`, `AI_MASK_PII=true`) |
| Reg 39 incident database | "Report AI issue" linked to the exact AI answer; Admin records cause, consequences and remedial measures (needed to close); CSV export |
| Reg 43(3) declaration | AI-use declaration added to the paper-book when AI drafted any part |
| Reg 43(4) disclosure on request | Filing → Export → *AI disclosure report (PDF)*: AI system, sections drafted, inputs, edits after AI, citation check, checklist ticks, approval, full activity record (IST) |
| Reg 16, 20(d)(f) | No outcome prediction, risk scoring or profiling anywhere |

**AOR verification checklist** – `python -m app.aor_checklist` (from `backend/`) writes
`docs/AOR_Verification_Checklist.docx`: every format rule, limitation period, paper-book part and fixed petition text
the app uses, with OK?/correction columns and the open questions first. Re-generate after changing any rule.

## Bare Acts (what the law says)

`/law` shows statutes **verbatim** from official PDFs, section by section - never written by AI.

| Act | Status | Source |
|---|---|---|
| BNS, BNSS, BSA (2023) | imported - 358 / 531 / 170 sections | Gazette of India, 25.12.2023 (as enacted; copy hosted by PRS) |
| IPC <-> BNS correspondence | 562 pairs (512 IPC sections, 28 deleted) | BPR&D (MHA) *Handbook on the BNS, 2023* - tables, with page numbers |
| IPC, CrPC, Evidence Act, Constitution | **add PDF** | India Code / Legislative Department - their PDF links did not download from this machine, so download them in a browser |

To add an Act: save the official PDF as `backend/data/statutes/raw/<CODE>.pdf` (`IPC`, `CRPC`, `IEA`, `COI`) and run
`python -m app.import_statutes` (from `backend/`). CrPC<->BNSS and IEA<->BSA correspondence is then matched by text and
marked *verify* (no official table was available). Sub-section numbers in the BPR&D table are shown as printed; the
section-level mapping is reliable, sub-sections should be checked against the text.

Where it is used:
- **Bare Acts page** - search ("302 IPC", "BNSS 482", "Article 21", "anticipatory bail"), contents by chapter, old<->new
  converter, and "Supreme Court judgments on this" (library judgments citing the provision or its counterpart).
- **Matter -> Applicable law** - every provision named in the matter's papers, where it appears, its text, and - from the
  date of the offence / cause of action - whether the IPC/CrPC/IEA (before 01.07.2024) or the new Sanhitas govern.
- **Research** - provisions named in the question are shown verbatim above the answer and given to the AI as the
  statutory text, so the answer quotes the law instead of recalling it.

## Hybrid RAG (retrieval)

Each analysed document is split into ~250-word overlapping **passages** (`services/passages.py`). Each passage is embedded
locally with a multilingual model through fastembed/ONNX (`services/embeddings.py`), so no API tokens are used and no text leaves the server.
A search runs two retrievers and fuses their rankings with Reciprocal Rank Fusion:

- **BM25 keywords**: exact citations, section numbers, party names.
- **Dense vectors**: meaning, synonyms ("termination" ↔ "dismissed"), and **Hindi questions over English judgments**.

Every result shows whether it matched by keyword, by meaning, or both.

| Setting (`backend/.env`) | Default | Notes |
|---|---|---|
| `EMBED_MODEL` | `minishlab/potion-multilingual-128M` | ~190 passages/s on a 4-core CPU. On a GPU or many-core server use `intfloat/multilingual-e5-large` (higher quality, ~1000× slower on CPU) |
| `RAG_DENSE` | `true` | `false` = keyword search only |
| `EMBED_CACHE_DIR` | `./models` | The model downloads here on first start |

After changing `EMBED_MODEL` (and `EMBED_DIM`), run `python -m app.reindex --all` to rebuild the passage vectors.

A citation in the query (`2025 INSC 1476`, `[2025] 12 S.C.R. 1307`, `(1978) 1 SCC 248`, `AIR 1973 SC 1461`) is also
matched as an exact phrase. The judgment that carries that citation is ranked first.

## Database: PostgreSQL + pgvector

The backend picks its search backend from `DATABASE_URL`:

| `DATABASE_URL` | Keyword search | Vector search | Use |
|---|---|---|---|
| `postgresql+psycopg://…` | Postgres full-text (GIN on a generated `tsvector`) | pgvector **HNSW** (cosine) | Full corpus, production |
| `sqlite:///./nyay.db` | In-memory BM25 | In-memory numpy | Quick local dev only |

**This machine (Windows):** PostgreSQL 16 + pgvector run inside **WSL Ubuntu**. Start them with
`backend\scripts\start_postgres.cmd` and keep that window open. WSL stops its VM, and Postgres with it, when no
Windows process is attached. Tables, the `vector` extension and all indexes are created automatically when the API starts.

**Production:** use a managed Postgres in an India region that supports pgvector (for example AWS RDS / Aurora PostgreSQL
in ap-south-1 Mumbai) and point `DATABASE_URL` at it.

## Supreme Court judgment library

All accounts share one public library of SC judgments (`documents.kind = 'judgment'`, `workspace_id = NULL`).
Every search covers this library plus the caller's own private documents. It never covers another account's documents.

- **Bulk import** from the [Indian Supreme Court Judgments](https://registry.opendata.aws/indian-supreme-court-judgments/)
  open dataset, a mirror of the official e-SCR (CC-BY-4.0, Dattam Labs; attribution is shown in the app):
  ```bash
  python -m app.import_corpus --from 2015 --to 2026          # pilot range (~9k judgments, ~1–1.5 h)
  python -m app.import_corpus --from 1950 --to 2026 --workers 6   # full corpus (~35k, several hours)
  ```
  The import is resumable: re-run it any time, for example after the dataset's bi-monthly update, and only new judgments are added.
  PDFs are **not stored**. Only text passages, embeddings, metadata and the source link are kept (roughly 0.2 MB per judgment in Postgres).
- **Import by link** (Research page): paste a PDF link from `scr.sci.gov.in` / `sci.gov.in` to add a judgment that
  the dataset doesn't have yet. Only `https` links on Supreme Court hosts are accepted.
- The e-SCR **search page is CAPTCHA-protected and is never automated**.
- **Production corpus:** 38,386 judgments (1950–2026), 6.2 GB in total, against a 10 GB cap for this deployment. 1950–2014 was imported
  with `--no-embed` (text only), so meaning and Hindi search reach only about 2015 onwards; keyword, case-name and citation search cover everything.

### How search ranks (`services/retrieval.py`)

- **Case name:** when all the query's words are in the titles of at most 25 judgments, those judgments come first.
- **Keywords, in tiers:** passages with every word, then every distinctive word, then any distinctive word. A word in more than 3% of
  passages counts as common, taken from PostgreSQL's statistics (run `ANALYZE passages` after a large import). Passages from a judgment that keeps returning to the words rank higher.
- **Exact citations** and case names weigh 3× in the RRF fusion; passages without embeddings count their keyword rank twice, so old judgments do not sink.
- **Filters** (period, judge, party, Section/Article with its old/new counterpart, court/tribunal) narrow the judgments first. Date sort orders the best 30 matches, not the whole library.

## Tribunal orders (NCLT / NCLAT)

Library judgments carry `meta.forum` (`SC` when missing, `NCLAT`, `NCLT`), `bench`, `case_no`, `members` and, for appeals,
`arising_from`. Code: `app/services/tribunal.py`.

- **Search:** forum filter in Legal Research; a tribunal order on the same point ranks below a Supreme Court judgment
  (`TRIBUNAL_WEIGHT = 0.8`) and carries a "persuasive, not binding" note. Tribunal case numbers (`Company Appeal (AT) (Insolvency)
  No. 45 of 2022`, `CP (IB) No. 123/MB/2021`) are matched like citations.
- **NCLAT import:** `python -m app.import_nclat --from YYYY-MM-DD --to YYYY-MM-DD [--bench delhi|chennai|all] [--max N]
  [--db-limit-gb 7.3] [--dry-run]`. Uses the tribunal's public "judgement date" search (no CAPTCHA), one request at a time with a
  3 s pause and an honest User-Agent; newest month first. Only final orders / judgments. The PDF is not stored: the source link opens
  it on nclat.nic.in. It stops by itself when the database reaches `--db-limit-gb` (the server's 10 GB budget; ≈175 KB per order).
  On the server it runs as the transient unit `nyay-nclat`, log `/home/nyayapex/nclat-import.log`.
- **NCLT:** its order search needs a CAPTCHA, which is not automated. Platform admins add NCLT (and NCLAT) orders as PDFs under
  Admin → Tribunal orders; the details read from the order are flagged for checking, and the PDF is stored encrypted.
- **Copyright:** both tribunals allow reproduction free of charge if accurate, not misleading, and the source is prominently
  acknowledged. Every order shows its forum and source.

## Website and citation graph

- **Public website:** `/`, `/features`, `/about`, `/contact`, `/responsible-ai`, `/privacy` and `/terms`. These are static pages
  with no login (`SITE_PATHS` in `lib/nav.ts`). The app's dashboard is at `/dashboard`, and a logged-in user who opens `/`
  is sent there. Contact-form messages appear under Admin → Website enquiries.
- **Citation graph** (`python -m app.citegraph`, rebuilt nightly by `app.jobs`): links each judgment to the library
  judgments it cites. Links are made by SCR or neutral citation number, or by case name and year, and only when exactly
  one judgment matches. The graph feeds `documents.cited_by` (a ranking boost of ×(1 + 0.5·log10(1+n)) plus a
  "landmark" candidate list), the precedent graph (`/precedent?doc=ID`) and validity. Validity reads the words later
  judgments use next to the case name and decides by proportion; conflicting signals are shown as "Mixed".

- **Orders:** on a matter's Hearings tab, "From an order" takes an order's sci.gov.in PDF link (which the advocate
  opens; the case-status search is CAPTCHA-protected and is never automated) or the PDF itself. `services/orders.py`
  reads the date, court, item, coram, what was ordered and the next date ("List on …", or "after N weeks" marked as
  an estimate) into a draft hearing note. Nothing is saved until the advocate checks and saves it.
- **Meaning search for old judgments:** `python -m app.embed_backfill` adds vectors to library passages that were imported
  with `--no-embed`. It can resume where it stopped, runs on the server's own model, and stops at `--limit-mb` (default 9300).

## Security

- **Files at rest:** uploads are AES-256-GCM encrypted when `FILE_KEY` is set (`python -m app.encrypt_files --new-key`,
  then `python -m app.encrypt_files` to encrypt files stored earlier). They are decrypted only in memory, or into a
  private temp file that is deleted right after. **If FILE_KEY is lost, every stored file is lost**, so keep a copy offline.
- **Sessions:** an httpOnly, Secure, SameSite=Lax cookie (`nyay_session`, path `/api`). With the cookie, changes need the
  `X-Nyay-Client: web` header (CSRF). Bearer tokens still work for scripts. Browsers that kept an older token in
  page storage swap it for the cookie once (`POST /api/auth/session`).
- **Rate limits** (`services/ratelimit.py`, kept in the database):
  - login: 30 per IP per 15 minutes, plus the per-account lockout
  - OTP: 20 per IP and 6 per number per hour; 10 verify attempts per 15 minutes
  - sign-up, forgot and reset: per IP
  - AI: `AI_CALLS_PER_HOUR` per account (default 300; cache hits are free)
- **Job queue:** with `JOB_WORKER=true`, uploads are analysed by `python -m app.worker` (systemd `nyay-worker`), not by
  the web server. A job killed midway is queued again after 45 minutes.
- **Access log:** every open, download or question on a private document is recorded; the document's "Access log" tab
  shows who did what and when.
- **Off-site backup:** `deploy/nyay-offsite-backup.sh` (cron 03:15) encrypts that night's dump, the uploads and `.env`
  with gpg AES-256 (passphrase `/root/.nyay-backup-pass`) and uploads them to S3-compatible storage configured in
  `/root/.nyay-offsite.env` (`OFFSITE_ENDPOINT`, `OFFSITE_BUCKET`, `OFFSITE_ACCESS_KEY`, `OFFSITE_SECRET_KEY`), keeping 30 days.
  To restore a file: `gpg -d FILE.gpg > FILE`.

## Hearings, cause lists and alerts

- **Cause lists** (`services/causelist.py`): a matter is found in a Supreme Court cause list only by its case number
  (`SLP(C) No. 30665/2026`) or diary number with year, never by party names. A daily-list listing sets the next hearing
  and notifies the team; an advance-list listing is shown as tentative.
- **Adding lists:** sci.gov.in refuses automated readers on its cause-list page (HTTP 403), and Nyay Apex does not get
  around that. Lists are added on the Chamber page or a matter's Hearings tab by pasting the PDF link from sci.gov.in
  (the server downloads it from `api.sci.gov.in` and shares it with every account) or by uploading the PDF (matched only to that account's matters).
- **Jobs:** `python -m app.jobs all`, run by the `nyay-jobs.timer` systemd timer (8 times a day, IST; log
  `/home/nyayapex/logs/jobs.log`). It tries the cause-list page and sends the evening reminders once a day: tomorrow's
  hearings, limitation 7/3/1/0 days ahead, tasks due tomorrow.
- **Hearing notes:** typed or dictated with browser voice typing. Follow-up tasks are suggested from rules (zero tokens)
  or, on request, by Haiku, and are created only when the advocate ticks them.
- **Calendar:** each user gets a secret iCalendar link for Google, Outlook or Apple. By default events show only the
  case or diary number.
- **WhatsApp alerts:** these go through the Cloudflare Worker in `docs/cloudflare-worker.js`
  (`WHATSAPP_API_BASE` = Worker URL). They need `WHATSAPP_NOTIFY_TEMPLATE`, an approved template with `{{1}}` name and `{{2}}` text.
- **Drafts:** a Word export is headed "DRAFT - NOT FILING-READY" until there are no placeholders, every risk flag is
  fixed or kept on purpose, every authority is verified, and the advocate has approved the draft.

## Where tokens are saved

| Step | Who does it | Tokens |
|---|---|---|
| PDF/DOCX text, OCR | PyMuPDF / Tesseract | 0 |
| Remove headers, footers, page numbers, duplicate pages | `services/clean.py` | 0 |
| Chronology dates, citation detection (SCC/AIR/MANU/SCR/INSC) | `services/dates.py`, `services/citations.py` | 0 |
| Registry format check, limitation calculator, draft risk lint | `format_check.py`, `limitation.py`, `lint.py` | 0 |
| Search (research, Q&A, courtroom) | Hybrid RAG in `services/retrieval.py` — BM25 + local embeddings, RRF fusion; only top passages go to Claude | 0 |
| Per-chunk fact extraction | Bulk model (Haiku), JSON output, low effort — or Batch API at 50% | low |
| Case brief / drafting | Smart model (Opus) — reads the compact chronology, not the record | small input |
| Same file uploaded again / same question again | SHA-256 dedupe + local answer cache in DB | 0 |

All Claude calls go through `backend/app/services/llm.py` (model tiers, prompt caching, structured output,
usage + cost logging shown on the **AI Usage & Cost** page). Opus calls use the server-side refusal fallback
(`server-side-fallback-2026-07-01`, `fallbacks: "default"`); remove it in `llm.py` if you don't want it.
Prompt caching only kicks in once a cached prefix passes the model's minimum length, so it pays off on long, repeated
system prompts — the short prompts here are mostly saved by the local cache instead.

## Before the pilot

- `format_check.RULES`, `limitation.PERIODS`, `filing_templates.py` and the drafting skeletons encode common SC
  practice — **an AOR must go through `docs/AOR_Verification_Checklist.docx`** before any real filing.
- Research / precedent validation currently run over judgments you upload. Hooking up the full SC corpus is the
  open build-vs-license decision in PRD §14.
- Production: PostgreSQL (`DATABASE_URL`) + pgvector with a self-hosted embedding model, Celery/RQ instead of
  FastAPI background tasks, auth + RBAC, hosting in an India region. Confirm Claude data-residency options with Anthropic.
