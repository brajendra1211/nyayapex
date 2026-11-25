# Draft "Regulations for Use of Artificial Intelligence in Courts, 2026" — Supreme Court of India

Source: SC Notice dated 03.06.2026 (AI Committee), comments were invited till 20.06.2026.
Status: **DRAFT** — check whether/when notified (Reg. 1(2): commencement by CJI notification for SC, by each HC Chief Justice for HCs).
Annexure I (party/advocate AI-use declaration) and Annexure II (Court AI-use declaration) are referenced but were **not included** in the published PDF.

## Who it binds
- Reg. 2: use of AI in judicial, adjudicatory or administrative functions of SC, HCs, all Courts, Tribunals, statutory Commissions.
- Advocates/parties are bound directly by **Reg. 43(3)–(6)** (disclosure + liability for AI-assisted filings) and by Reg. 3(1)(y) (GenAI content filed in court).
- If Nyay Apex is ever offered **to a Court/Registry**, all of Chapters III–VII apply to us as an "AI Service Provider" (Reg. 3(1)(h), 46).

## Rules that shape Nyay Apex (advocate-side product)

| Reg. | Rule | What it means for us |
|---|---|---|
| 3(1)(y), 43(3) | GenAI content filed/produced in Court must disclose its origin; AI-assisted pleadings/documents/evidence need a declaration (Annexure I) at the time of submission | Every AI draft must carry an AI-assistance marker and the app must generate the **AI-use disclosure declaration** for filing; keep a per-document log of which parts were AI-assisted |
| 43(4) | Court may demand: AI system used, extent of assistance, verification steps taken | Keep an **audit trail** per draft: model, date, inputs used, what the advocate verified/edited |
| 43(6) | Fabricated/false AI content → full responsibility on the person submitting; "the AI did it" is no defence | Hallucination guard: never show uncited facts/citations; force human verification before "filing-ready" |
| 3(1)(z) | Hallucination = fabricated/misstated facts, evidence, precedents, statutes | Citation must always be traceable to a source document/page; flag unverified authorities |
| 3(1)(zb), 4, 8(3), 12(2) | Human-in-the-Loop; AI output is advisory; verify before use | No autonomous filing; explicit "reviewed & approved by advocate" step |
| 16(1) proviso | AI shall not be deployed for **dispute-outcome prediction** | Do **not** build "chance of winning"/outcome prediction. Registry *defect* prediction is administrative (19(1)(a),(e)) and fine |
| 20(1)(d) | No Risk Scoring — flight risk, recidivism, bail eligibility, credibility of parties/witnesses | No witness-credibility or bail-likelihood scoring. Contradiction detection must cite pages, not score credibility |
| 20(1)(f) | No predicting/profiling future conduct of parties, accused, witnesses, legal representatives | No profiling of opposing counsel/parties |
| 20(1)(g) | No surveillance/continuous monitoring of judicial officers, advocates, litigants | PRD's "bench synchronization intelligence / bench-specific recommendations" must stay at listing/roster facts — **no judge-behaviour profiling** |
| 20(1)(h) | AI output never submitted as independent evidence without full disclosure | Briefs/chronologies are work-product, never exhibits |
| 20(1)(e), 7 | No opaque/unexplainable AI where rights/liberty are affected; explainability | Every output shows its sources/working (we already do for limitation, compliance, precedent) |
| 3(1)(zh), 10, 47, 48 | Sensitive judicial data; DPDP Act 2023 + IT Act 2000; data minimisation; anonymisation; least-privilege access | Send minimum text to the LLM (already: chunk retrieval, compact chronology); India data residency; RBAC; access logs; option to redact PII before AI calls |
| 48(1) | Sensitive judicial data not to External Systems without authorisation (Court-side) | Matters if a Court/Registry uses us: on-prem / sovereign-cloud option (46(4)(j)) |
| 46(4) | Vendor contracts: data ownership, no use beyond scope, audit rights, incident reporting, no retraining on Court data, indemnity, on-prem/sovereign cloud, explainability docs | Needed before any Court/Registry deal |
| 38(2) | Audits in-house; source/data not shared outside Court premises | Court-side deployment must support in-house audit |
| 39, 46(6) | AI Incident reporting | Keep an incident log (wrong citation, hallucination reported by user) |
| 19(1)(d) | Permissible: legal research, precedent retrieval, citation verification, summarisation | Our core features fall within permissible uses |

## Key definitions (short)
- **AI Incident** 3(1)(e): use/failure/erroneous output causing or risking harm, rights infringement, court-process disruption, or data breach.
- **Hallucination** 3(1)(z): plausible but false/fabricated output incl. legal facts, evidence, precedents, statutes.
- **HITL** 3(1)(zb): mandatory human review; final authority and accountability always with a human.
- **Sensitive judicial data** 3(1)(zh): PII of parties, witnesses, legal representatives, and any court-process info whose disclosure may cause harm.
- **Risk Scoring** 3(1)(zg): numerical/categorical score predicting a person's future behaviour.
