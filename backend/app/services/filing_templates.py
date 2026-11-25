"""Fixed (boilerplate) legal text for Supreme Court filing packages - written by people, never by AI.

EVERY string here follows common Supreme Court practice but MUST be verified by an Advocate-on-Record against
the Supreme Court Rules, 2013 and current Registry circulars before real use. Items we are unsure of carry
"[VERIFY …]". Replace with the chamber's own formats when available - nothing else in the code needs to change.

Placeholders use {name} and are filled from the matter, the AOR's profile and the wizard inputs.
"""

VERIFY_NOTE = "Template text follows common practice and must be verified by an AOR before filing."

PROCEEDINGS = {
    "slp_civil": {
        "label": "Special Leave Petition (Civil)",
        "jurisdiction": "CIVIL APPELLATE JURISDICTION",
        "title": "SPECIAL LEAVE PETITION (CIVIL) NO. ______ OF {year}",
        "under": "(Under Article 136 of the Constitution of India)",
        "rule_no_other_petition": "[VERIFY: Order XXI Rule 3(2), SC Rules 2013]",
        "rule_annexures": "[VERIFY: Order XXI Rule 4, SC Rules 2013]",
    },
}

ADDRESS = ("To,\nThe Hon'ble the Chief Justice of India\nand His Companion Justices of\nthe Supreme Court of India")

PETITION_OPENING = ("The humble petition of the Petitioner above-named\n\nMOST RESPECTFULLY SHOWETH:")

PARA_1 = ("The Petitioner seeks special leave to appeal against the final judgment and order dated {order_date} "
          "passed by the High Court of {high_court} in {case_below}, whereby the High Court {held}.")

DECLARATION_NO_OTHER = ("DECLARATION IN TERMS OF {rule}\n"
                        "The Petitioner states that no other petition seeking leave to appeal has been filed by the "
                        "Petitioner against the impugned judgment and order dated {order_date}.")

DECLARATION_ANNEXURES = ("DECLARATION IN TERMS OF {rule}\n"
                         "The Annexures P-1 to P-{last_annexure} produced along with the Special Leave Petition are true "
                         "copies of the pleadings/documents which formed part of the records of the case in the Court below "
                         "against whose order leave to appeal is sought for in this petition.")

DEFAULT_MAIN_PRAYER = [
    "grant special leave to appeal against the final judgment and order dated {order_date} passed by the High Court of {high_court} in {case_below}; and",
    "pass such other or further order(s) as this Hon'ble Court may deem fit and proper in the facts and circumstances of the case.",
]

DEFAULT_INTERIM_PRAYER = [
    "grant ex-parte ad-interim stay of the operation of the final judgment and order dated {order_date} passed by the High Court of {high_court} in {case_below}; and",
    "pass such other or further order(s) as this Hon'ble Court may deem fit and proper.",
]

CLOSING = "AND FOR THIS ACT OF KINDNESS, THE PETITIONER, AS IN DUTY BOUND, SHALL EVER PRAY."

CERTIFICATE = (
    "Certified that the Special Leave Petition is confined only to the pleadings before the Court whose order is "
    "challenged and the other documents relied upon in those proceedings. No additional facts, documents or grounds "
    "have been taken therein or relied upon in the Special Leave Petition. It is further certified that the copies of "
    "the documents/annexures attached to the Special Leave Petition are necessary to answer the question of law raised "
    "in the petition or to make out grounds urged in the Special Leave Petition for consideration of this Hon'ble Court. "
    "This certificate is given on the basis of the instructions given by the Petitioner/person authorised by the "
    "Petitioner whose affidavit is filed in support of the Special Leave Petition."
)

AFFIDAVIT = [
    "I, {deponent_name}, {deponent_relation}, aged about {deponent_age} years, resident of {deponent_address}, do hereby "
    "solemnly affirm and declare as under:",
    "That I am the {deponent_capacity} in the above matter and am well conversant with the facts and circumstances of the "
    "case and as such competent to swear this affidavit.",
    "That I have read and understood the contents of the accompanying Synopsis and List of Dates (pages ___ to ___), the "
    "Special Leave Petition (paras 1 to ___, pages ___ to ___) and the Interlocutory Application(s), which have been drafted "
    "by my counsel under my instructions, and state that the facts stated therein are true and correct to my knowledge and "
    "belief.",
    "That the Annexures annexed to the Special Leave Petition are true copies of their respective originals.",
    "That I have not suppressed any material fact.",
]
VERIFICATION = ("VERIFICATION\nVerified at {place} on this ___ day of ________, {year} that the contents of paras 1 to {n} of "
                "the above affidavit are true and correct to my knowledge and belief, no part of it is false and nothing "
                "material has been concealed therefrom.")

IA_EXEMPTION_CC = {
    "title": "APPLICATION FOR EXEMPTION FROM FILING CERTIFIED COPY OF THE IMPUGNED JUDGMENT",
    "paras": [
        "That the Petitioner has filed the accompanying Special Leave Petition against the final judgment and order dated "
        "{order_date} passed by the High Court of {high_court} in {case_below}.",
        "That the Petitioner has applied for the certified copy of the impugned judgment, which has not yet been received. "
        "The Petitioner is filing the Special Leave Petition with a copy of the impugned judgment downloaded from the "
        "official website of the High Court, and undertakes to file the certified copy as and when received.",
        "That the application is bona fide and in the interest of justice.",
    ],
    "prayer": ["exempt the Petitioner from filing the certified copy of the impugned judgment and order dated {order_date}; and",
               "pass such other or further order(s) as this Hon'ble Court may deem fit and proper."],
}

IA_DELAY = {
    "title": "APPLICATION FOR CONDONATION OF DELAY IN FILING THE SPECIAL LEAVE PETITION",
    "lead": ("That the Petitioner has filed the accompanying Special Leave Petition against the final judgment and order "
             "dated {order_date} passed by the High Court of {high_court} in {case_below}. There is a delay of {delay_days} "
             "days in filing the Special Leave Petition."),
    "close": ("That the delay is neither deliberate nor intentional and has occurred for the bona fide reasons stated above. "
              "Sufficient cause is made out for condoning the delay under Section 5 of the Limitation Act, 1963."),
    "prayer": ["condone the delay of {delay_days} days in filing the accompanying Special Leave Petition; and",
               "pass such other or further order(s) as this Hon'ble Court may deem fit and proper."],
}

IA_STAY = {
    "title": "APPLICATION FOR EX-PARTE AD-INTERIM STAY",
    "lead": ("That the Petitioner has filed the accompanying Special Leave Petition against the final judgment and order "
             "dated {order_date} passed by the High Court of {high_court} in {case_below}. The facts and grounds stated "
             "in the Special Leave Petition are not repeated for the sake of brevity and may be read as part of this application."),
    "close": ("That the Petitioner has a strong prima facie case, the balance of convenience lies in favour of the Petitioner "
              "and the Petitioner will suffer irreparable loss and injury if the interim relief is not granted."),
}

VAKALATNAMA = [
    "I/We, {client_names}, the {client_capacity} in the above matter, do hereby appoint and retain {aor_name}, "
    "Advocate-on-Record, Supreme Court of India, to act and appear for me/us in the above matter and on my/our behalf to "
    "conduct and prosecute (or defend) the same and all proceedings that may be taken in respect of any application "
    "connected with the same or any decree or order passed therein, including proceedings in taxation and application for "
    "review, to file and obtain return of documents, and to deposit and receive money on my/our behalf in the said matter "
    "and in applications for review, and to represent me/us and to take all necessary steps on my/our behalf in the above matter.",
    "I/We agree to ratify all acts done by the aforesaid Advocate-on-Record in pursuance of this authority.",
    "[VERIFY: chamber's standard Vakalatnama format, stamp/welfare fund requirements and attestation]",
]

MEMO_OF_APPEARANCE = ("To,\nThe Registrar,\nSupreme Court of India,\nNew Delhi.\n\nSir,\nPlease enter my appearance on behalf "
                      "of the {client_capacity} in the above matter.\n\nYours faithfully,")

# SC AI Regulations, 2026 (draft) Reg. 43(3): AI-assisted pleadings must carry a declaration. The official
# Annexure I format has not been published; this wording is a placeholder to be replaced by the official one.
AI_DISCLOSURE = (
    "DECLARATION REGARDING USE OF ARTIFICIAL INTELLIGENCE\n"
    "[Draft wording - replace with the format prescribed in Annexure I of the Regulations for Use of Artificial "
    "Intelligence in Courts, 2026, when notified]\n\n"
    "I, {aor_name}, Advocate-on-Record for the {client_capacity}, declare that an artificial-intelligence tool "
    "({ai_tool}) was used to assist in preparing the following parts of this filing: {ai_parts}. Every such part, "
    "every fact and every authority cited has been reviewed and verified by me against the record and the original "
    "judgments, and I take full responsibility for the contents of this filing."
)

CHECKLIST = [
    ("facts", "Every fact, date and page reference has been checked against the record."),
    ("citations", "Every authority cited has been read in the original judgment and is still good law."),
    ("annexures", "Annexures are true copies, correctly marked P-1 onwards and listed in the index."),
    ("limitation", "Limitation has been checked; delay (if any) is explained in the I.A."),
    ("format", "Format (A4, font, margins, pagination) has been checked by the Registry Compliance tool."),
    ("ai", "Where AI assisted, its output has been reviewed line by line and the AI-use declaration is correct."),
]
