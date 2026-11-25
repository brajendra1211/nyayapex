"""Hindi and Hinglish legal terms -> the English words Supreme Court judgments use. Zero tokens, deterministic.

A query like "अग्रिम जमानत" or "agrim zamanat" is searched together with "anticipatory bail", so judgments (written in
English) are found by keyword as well as by meaning. Longest phrases are matched first.
"""

import re

GLOSSARY: dict[str, str] = {
    # bail, arrest, custody
    "अग्रिम जमानत": "anticipatory bail", "अग्रिम ज़मानत": "anticipatory bail", "agrim jamanat": "anticipatory bail",
    "agrim zamanat": "anticipatory bail", "pre arrest bail": "anticipatory bail",
    "जमानत": "bail", "ज़मानत": "bail", "jamanat": "bail", "zamanat": "bail",
    "डिफ़ॉल्ट जमानत": "default bail", "वैधानिक जमानत": "default bail statutory bail",
    "गिरफ्तारी": "arrest", "गिरफ़्तारी": "arrest", "giraftari": "arrest",
    "पुलिस हिरासत": "police custody", "न्यायिक हिरासत": "judicial custody", "हिरासत": "custody", "hirasat": "custody",
    "हिरासत में मौत": "custodial death", "हिरासत में हिंसा": "custodial violence", "निवारक निरोध": "preventive detention",
    # offences
    "दहेज मृत्यु": "dowry death", "दहेज हत्या": "dowry death", "दहेज के लिए": "dowry", "दहेज": "dowry", "dahej": "dowry",
    "धोखाधड़ी": "cheating", "धोखे": "cheating", "धोखा": "cheating", "ठगी": "cheating", "जालसाज़ी": "forgery", "जालसाजी": "forgery", "dhokha": "cheating", "thagi": "cheating", "हत्या": "murder", "hatya": "murder", "हत्या का प्रयास": "attempt to murder", "गैर इरादतन हत्या": "culpable homicide not amounting to murder",
    "बलात्कार": "rape", "balatkar": "rape", "यौन उत्पीड़न": "sexual harassment", "छेड़छाड़": "outraging modesty",
    "अपहरण": "kidnapping abduction", "फिरौती": "ransom", "डकैती": "dacoity", "लूट": "robbery", "चोरी": "theft",
    "धोखाधड़ी": "cheating fraud", "dhokhadhadi": "cheating fraud", "जालसाजी": "forgery", "आपराधिक न्यासभंग": "criminal breach of trust",
    "आत्महत्या के लिए उकसाना": "abetment of suicide", "आत्महत्या": "suicide", "क्रूरता": "cruelty", "घरेलू हिंसा": "domestic violence",
    "मानहानि": "defamation", "भ्रष्टाचार": "corruption", "रिश्वत": "bribe illegal gratification", "नशीले पदार्थ": "narcotic drugs NDPS",
    "चेक बाउंस": "dishonour of cheque section 138", "चेक अनादरण": "dishonour of cheque section 138", "cheque bounce": "dishonour of cheque section 138",
    "आपराधिक षड्यंत्र": "criminal conspiracy", "साझा आशय": "common intention", "गैरकानूनी जमाव": "unlawful assembly",
    # trial and evidence
    "प्राथमिकी": "first information report FIR", "एफआईआर": "FIR first information report", "आरोप पत्र": "chargesheet",
    "मृत्युकालिक कथन": "dying declaration", "मृत्यु पूर्व बयान": "dying declaration", "मरने से पहले का बयान": "dying declaration",
    "चश्मदीद गवाह": "eye witness", "गवाह": "witness", "साक्ष्य": "evidence", "सबूत": "evidence", "परिस्थितिजन्य साक्ष्य": "circumstantial evidence",
    "इकबालिया बयान": "confession", "स्वीकारोक्ति": "confession", "पहचान परेड": "test identification parade",
    "दोषमुक्ति": "acquittal", "बरी": "acquittal", "दोषसिद्धि": "conviction", "सजा": "sentence", "सज़ा": "sentence",
    "मृत्युदंड": "death penalty death sentence", "फांसी": "death sentence", "फाँसी": "death sentence", "आजीवन कारावास": "life imprisonment",
    "दुर्लभतम में दुर्लभ": "rarest of rare", "विरलतम": "rarest of rare", "किशोर न्याय": "juvenile justice", "पैरोल": "parole",
    # family
    "तलाक": "divorce", "talaq": "talaq divorce", "तीन तलाक": "triple talaq", "भरण पोषण": "maintenance", "भरण-पोषण": "maintenance",
    "गुजारा भत्ता": "maintenance alimony", "बच्चे की अभिरक्षा": "custody of child", "गोद लेना": "adoption", "विवाह": "marriage",
    "स्त्रीधन": "stridhan",
    # property and civil
    "भूमि अधिग्रहण": "land acquisition", "मुआवजा": "compensation", "मुआवज़ा": "compensation", "muavja": "compensation",
    "संपत्ति": "property", "किरायेदार": "tenant", "मकान मालिक": "landlord", "बेदखली": "eviction", "विभाजन": "partition",
    "वसीयत": "will testament", "उत्तराधिकार": "succession inheritance", "प्रतिकूल कब्जा": "adverse possession", "कब्जा": "possession",
    "विक्रय अनुबंध": "agreement to sell", "विशिष्ट पालन": "specific performance", "निषेधाज्ञा": "injunction", "स्थगन": "stay",
    "अंतरिम रोक": "interim stay", "परिसीमा": "limitation", "विलंब माफी": "condonation of delay", "देरी माफी": "condonation of delay",
    "मध्यस्थता": "arbitration", "उपभोक्ता": "consumer", "बीमा": "insurance", "मोटर दुर्घटना": "motor accident compensation",
    # constitutional and service
    "मौलिक अधिकार": "fundamental rights", "जीवन और व्यक्तिगत स्वतंत्रता": "life and personal liberty article 21",
    "व्यक्तिगत स्वतंत्रता": "personal liberty", "निजता": "privacy", "अभिव्यक्ति की स्वतंत्रता": "freedom of speech and expression",
    "समानता": "equality article 14", "आरक्षण": "reservation", "क्रीमी लेयर": "creamy layer", "मूल ढांचा": "basic structure",
    "मूल संरचना": "basic structure", "राष्ट्रपति शासन": "president's rule article 356", "जनहित याचिका": "public interest litigation",
    "रिट याचिका": "writ petition", "विशेष अनुमति याचिका": "special leave petition", "बंदी प्रत्यक्षीकरण": "habeas corpus",
    "अवमानना": "contempt", "प्राकृतिक न्याय": "natural justice", "सुनवाई का अवसर": "opportunity of hearing",
    "सेवा से बर्खास्त": "dismissal from service", "बर्खास्तगी": "dismissal from service", "पदोन्नति": "promotion", "वरिष्ठता": "seniority",
    "पेंशन": "pension", "नियमितीकरण": "regularisation", "पर्यावरण": "environment", "प्रदूषण": "pollution", "शिक्षा का अधिकार": "right to education",
    # courts and words of reference
    "उच्चतम न्यायालय": "Supreme Court", "उच्च न्यायालय": "High Court", "सत्र न्यायालय": "Sessions Court", "निचली अदालत": "trial court",
    "धारा": "section", "अनुच्छेद": "article", "दंड प्रक्रिया संहिता": "CrPC", "भारतीय दंड संहिता": "IPC",
    "भारतीय न्याय संहिता": "BNS Bharatiya Nyaya Sanhita", "भारतीय नागरिक सुरक्षा संहिता": "BNSS", "भारतीय साक्ष्य अधिनियम": "BSA evidence",
}
DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_KEYS = sorted(GLOSSARY, key=len, reverse=True)


def english_terms(query: str) -> list[str]:
    """English equivalents of the Hindi / Hinglish legal terms in the query (longest phrase wins, no repeats)."""
    q = query.translate(DEVANAGARI_DIGITS).lower()
    found: list[str] = []
    for k in _KEYS:
        kl = k.lower()
        pattern = re.escape(kl) if not kl.isascii() else rf"\b{re.escape(kl)}\b"
        if re.search(pattern, q):
            q = re.sub(pattern, " ", q)  # a longer phrase consumes its words (अग्रिम जमानत, not also जमानत)
            if GLOSSARY[k] not in found:
                found.append(GLOSSARY[k])
    return found


def expand(query: str) -> tuple[str, list[str]]:
    """(query to search, English terms added). Numbers like धारा ३०२ become section 302."""
    terms = english_terms(query)
    if not terms:
        return query, []
    if "dowry" in terms and "murder" in terms:  # "दहेज के लिए बहू की हत्या": the law calls it dowry death
        terms.append("dowry death 304B")
    nums = " ".join(re.findall(r"\d+[a-z]?", query.translate(DEVANAGARI_DIGITS), re.I))
    return f"{query} {' '.join(terms)} {nums}".strip(), terms
