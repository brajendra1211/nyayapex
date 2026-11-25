"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { NotAdvice } from "@/components/personal/kit";
import { Badge, Card, Input, PageHeader } from "@/components/ui";

type Word = { t: string; hi: string; en: string; hiText: string; group: Group };
type Group = "Police & criminal" | "Court process" | "Civil & family" | "Orders & results" | "People & papers";

// Plain meanings for general understanding. Section numbers: new law (BNS / BNSS / BSA, from 1 July 2024), old law in brackets.
const WORDS: Word[] = [
  // Police & criminal
  { group: "Police & criminal", t: "FIR (First Information Report)", hi: "प्रथम सूचना रिपोर्ट", en: "The first written report of a serious (cognizable) crime made to the police. Police must register it and give you a free copy (BNSS s. 173; old CrPC s. 154).", hiText: "किसी गंभीर अपराध की पुलिस को दी गई पहली लिखित सूचना। पुलिस को इसे दर्ज करना होता है और आपको इसकी मुफ़्त कॉपी देनी होती है।" },
  { group: "Police & criminal", t: "Zero FIR", hi: "ज़ीरो एफ़आईआर", en: "An FIR that any police station must register even if the crime happened in another area; it is then sent to the right police station.", hiText: "अपराध किसी और इलाके में हुआ हो तब भी कोई भी थाना FIR दर्ज करेगा और फिर सही थाने को भेजेगा।" },
  { group: "Police & criminal", t: "Cognizable offence", hi: "संज्ञेय अपराध", en: "A serious offence where the police can register an FIR and arrest without a court's permission (e.g. theft, assault, murder).", hiText: "गंभीर अपराध जिसमें पुलिस बिना कोर्ट की अनुमति के FIR दर्ज कर गिरफ़्तार कर सकती है।" },
  { group: "Police & criminal", t: "Non-cognizable offence", hi: "असंज्ञेय अपराध", en: "A less serious offence; police record it in a register (NCR) and need a magistrate's order to investigate.", hiText: "कम गंभीर अपराध; पुलिस को जांच के लिए मजिस्ट्रेट की अनुमति चाहिए।" },
  { group: "Police & criminal", t: "Bail", hi: "ज़मानत", en: "Release of an arrested person from custody while the case goes on, usually on a bond or surety, with conditions set by the police or court.", hiText: "मुकदमा चलते हुए गिरफ़्तार व्यक्ति की हिरासत से रिहाई, आमतौर पर बॉन्ड/ज़मानतदार और शर्तों के साथ।" },
  { group: "Police & criminal", t: "Bailable / non-bailable offence", hi: "ज़मानती / गैर-ज़मानती अपराध", en: "In a bailable offence bail is a right. In a non-bailable offence the court decides whether to give bail.", hiText: "ज़मानती अपराध में ज़मानत अधिकार है; गैर-ज़मानती में कोर्ट तय करता है।" },
  { group: "Police & criminal", t: "Anticipatory bail", hi: "अग्रिम ज़मानत", en: "Bail asked for before arrest, by someone who fears arrest in a non-bailable case (BNSS s. 482; old CrPC s. 438).", hiText: "गिरफ़्तारी से पहले मांगी जाने वाली ज़मानत, जब गैर-ज़मानती मामले में गिरफ़्तारी का डर हो।" },
  { group: "Police & criminal", t: "Charge sheet", hi: "आरोप पत्र", en: "The police report filed in court after investigation, saying what offence they think was committed and the evidence (BNSS s. 193; old CrPC s. 173).", hiText: "जांच के बाद पुलिस की कोर्ट में दी गई रिपोर्ट, जिसमें अपराध और सबूतों का ब्योरा होता है।" },
  { group: "Police & criminal", t: "Closure report", hi: "क्लोज़र रिपोर्ट", en: "A police report saying there is not enough evidence to go to trial. The complainant can object to it in court.", hiText: "पुलिस की रिपोर्ट कि मुकदमे के लिए पर्याप्त सबूत नहीं हैं; शिकायतकर्ता कोर्ट में आपत्ति कर सकता है।" },
  { group: "Police & criminal", t: "Police custody / judicial custody", hi: "पुलिस हिरासत / न्यायिक हिरासत", en: "Police custody: kept with the police for questioning. Judicial custody: kept in jail under the court's control.", hiText: "पुलिस हिरासत में पूछताछ के लिए पुलिस के पास; न्यायिक हिरासत में कोर्ट के आदेश से जेल में।" },
  { group: "Police & criminal", t: "Accused", hi: "अभियुक्त / आरोपी", en: "The person said to have committed the offence. An accused is presumed innocent until proved guilty.", hiText: "जिस पर अपराध करने का आरोप है; दोष सिद्ध होने तक निर्दोष माना जाता है।" },
  { group: "Police & criminal", t: "Compoundable offence", hi: "शमनीय अपराध", en: "An offence that the parties are allowed to settle (compromise) between themselves, sometimes with the court's permission.", hiText: "ऐसा अपराध जिसमें पक्षकार आपस में समझौता कर सकते हैं।" },

  // Court process
  { group: "Court process", t: "Petition / plaint / complaint", hi: "याचिका / वादपत्र / परिवाद", en: "The paper that starts a case: plaint in a civil suit, complaint in a criminal case filed directly in court, petition in a High Court or Supreme Court.", hiText: "मुकदमा शुरू करने वाला दस्तावेज़: दीवानी में वादपत्र, आपराधिक में परिवाद, हाईकोर्ट/सुप्रीम कोर्ट में याचिका।" },
  { group: "Court process", t: "Summons", hi: "समन", en: "A court's written order telling a person to appear in court (or produce a document) on a given date.", hiText: "कोर्ट का लिखित आदेश कि व्यक्ति तय तारीख पर हाज़िर हो या दस्तावेज़ पेश करे।" },
  { group: "Court process", t: "Warrant", hi: "वारंट", en: "A court's order to the police to arrest a person and bring them to court (bailable or non-bailable warrant).", hiText: "कोर्ट का पुलिस को आदेश कि व्यक्ति को गिरफ़्तार कर कोर्ट में पेश करे।" },
  { group: "Court process", t: "Notice", hi: "नोटिस", en: "Formal information to a party that a case or application has been filed and they may reply or appear.", hiText: "पक्षकार को औपचारिक सूचना कि मामला दायर हुआ है और वह जवाब दे सकता है।" },
  { group: "Court process", t: "Hearing / next date", hi: "सुनवाई / अगली तारीख", en: "A day on which the court takes up the case. The 'next date' is the day it is listed again.", hiText: "जिस दिन कोर्ट मामला सुनता है; अगली तारीख वह दिन है जब मामला फिर लगेगा।" },
  { group: "Court process", t: "Adjournment", hi: "स्थगन", en: "Putting the hearing off to another date.", hiText: "सुनवाई को दूसरी तारीख तक टालना।" },
  { group: "Court process", t: "Cause list", hi: "वाद सूची", en: "The court's daily list of cases to be heard, with court number and item number.", hiText: "कोर्ट की रोज़ की सूची जिसमें सुने जाने वाले मामले, कोर्ट नंबर और आइटम नंबर होते हैं।" },
  { group: "Court process", t: "Written statement / reply", hi: "लिखित कथन / जवाब", en: "The other side's written answer to the case filed against them.", hiText: "विपक्षी का अपने ख़िलाफ़ दायर मामले पर लिखित जवाब।" },
  { group: "Court process", t: "Affidavit", hi: "शपथ पत्र", en: "A written statement of facts that the person swears is true. A false affidavit is an offence.", hiText: "तथ्यों का लिखित बयान जिसे व्यक्ति शपथ लेकर सच बताता है; झूठा शपथ पत्र अपराध है।" },
  { group: "Court process", t: "Evidence", hi: "साक्ष्य / सबूत", en: "Documents and witness statements the court relies on to decide facts (Bharatiya Sakshya Adhiniyam, 2023; old Indian Evidence Act).", hiText: "दस्तावेज़ और गवाहों के बयान जिनसे कोर्ट तथ्य तय करता है।" },
  { group: "Court process", t: "Examination / cross-examination", hi: "मुख्य परीक्षा / प्रतिपरीक्षा", en: "Questions to a witness by the side that called them (examination), then by the other side (cross-examination).", hiText: "गवाह से पहले बुलाने वाले पक्ष के सवाल, फिर विपक्ष के सवाल।" },
  { group: "Court process", t: "Framing of charge", hi: "आरोप तय करना", en: "In a criminal trial, the court formally states the offence the accused is to be tried for.", hiText: "आपराधिक मुकदमे में कोर्ट औपचारिक रूप से तय करता है कि किस अपराध का मुकदमा चलेगा।" },
  { group: "Court process", t: "Arguments", hi: "बहस", en: "The lawyers' final submissions explaining why the court should decide in their side's favour.", hiText: "वकीलों की अंतिम दलीलें कि फ़ैसला उनके पक्ष में क्यों हो।" },
  { group: "Court process", t: "Judgment reserved", hi: "फ़ैसला सुरक्षित", en: "Hearing is over; the court will give its judgment on a later day.", hiText: "सुनवाई पूरी; कोर्ट बाद में फ़ैसला सुनाएगा।" },
  { group: "Court process", t: "Ex parte", hi: "एकपक्षीय", en: "When the court goes ahead without one side because they did not appear after notice.", hiText: "जब नोटिस के बाद भी एक पक्ष हाज़िर न हो और कोर्ट उसके बिना आगे बढ़े।" },
  { group: "Court process", t: "Limitation", hi: "परिसीमा / समय सीमा", en: "The time limit within which a case or appeal must be filed. A late filing may be rejected unless the delay is excused.", hiText: "मामला या अपील दायर करने की समय सीमा; देर होने पर देरी माफ़ न हो तो याचिका ख़ारिज हो सकती है।" },
  { group: "Court process", t: "Condonation of delay", hi: "विलंब माफ़ी", en: "A request to the court to accept a case or appeal filed after the time limit, giving reasons for the delay.", hiText: "समय सीमा के बाद दायर मामले को स्वीकार करने की कोर्ट से प्रार्थना, कारण सहित।" },
  { group: "Court process", t: "Vakalatnama", hi: "वकालतनामा", en: "The paper by which you appoint an advocate to act for you in a case.", hiText: "वह दस्तावेज़ जिससे आप किसी वकील को अपने मामले के लिए नियुक्त करते हैं।" },
  { group: "Court process", t: "Certified copy", hi: "प्रमाणित प्रति", en: "A copy of a court record or order officially certified by the court; needed for appeals.", hiText: "कोर्ट के रिकॉर्ड/आदेश की कोर्ट द्वारा प्रमाणित कॉपी; अपील के लिए ज़रूरी।" },

  // Civil & family
  { group: "Civil & family", t: "Suit", hi: "वाद / दीवानी मुकदमा", en: "A civil case, for example about property, money or a contract.", hiText: "दीवानी मामला, जैसे संपत्ति, पैसे या अनुबंध से जुड़ा।" },
  { group: "Civil & family", t: "Injunction / stay", hi: "निषेधाज्ञा / स्थगन आदेश", en: "A court order stopping someone from doing something (injunction), or pausing an order or proceeding (stay).", hiText: "किसी को कुछ करने से रोकने का आदेश, या किसी आदेश/कार्यवाही को रोकना।" },
  { group: "Civil & family", t: "Decree", hi: "डिक्री", en: "The formal final decision in a civil suit that can be enforced.", hiText: "दीवानी मुकदमे का औपचारिक अंतिम निर्णय जिसे लागू कराया जा सकता है।" },
  { group: "Civil & family", t: "Execution", hi: "निष्पादन", en: "The process of getting a decree or award actually carried out, e.g. recovering money or possession.", hiText: "डिक्री को असल में लागू कराना, जैसे पैसा या कब्ज़ा दिलाना।" },
  { group: "Civil & family", t: "Maintenance", hi: "भरण-पोषण", en: "Money ordered to be paid for the living expenses of a wife, children or parents who cannot maintain themselves (BNSS s. 144; old CrPC s. 125).", hiText: "पत्नी, बच्चों या माता-पिता के गुज़ारे के लिए दिया जाने वाला पैसा।" },
  { group: "Civil & family", t: "Mutual consent divorce", hi: "आपसी सहमति से तलाक", en: "Divorce where both spouses agree to separate and jointly ask the family court.", hiText: "जब पति-पत्नी दोनों अलग होने पर सहमत हों और फ़ैमिली कोर्ट में मिलकर अर्ज़ी दें।" },
  { group: "Civil & family", t: "Mediation / Lok Adalat", hi: "मध्यस्थता / लोक अदालत", en: "Ways to settle a dispute by agreement. A Lok Adalat settlement is final and has no court fee.", hiText: "समझौते से विवाद सुलझाने के तरीके; लोक अदालत का समझौता अंतिम होता है और कोर्ट फ़ीस नहीं लगती।" },
  { group: "Civil & family", t: "Legal notice", hi: "क़ानूनी नोटिस", en: "A formal letter, usually through an advocate, telling the other side of a claim before going to court.", hiText: "कोर्ट जाने से पहले विपक्ष को दावा बताने वाला औपचारिक पत्र, आमतौर पर वकील द्वारा।" },
  { group: "Civil & family", t: "Cheque bounce (Section 138)", hi: "चेक बाउंस", en: "When a cheque given to pay a debt is returned unpaid; it can lead to a criminal case under s. 138 of the Negotiable Instruments Act after a notice.", hiText: "कर्ज़ चुकाने का चेक बिना भुगतान लौटे तो नोटिस के बाद NI Act की धारा 138 में मामला बन सकता है।" },

  // Orders & results
  { group: "Orders & results", t: "Interim order", hi: "अंतरिम आदेश", en: "A temporary order that lasts while the case is pending.", hiText: "मामला चलने तक लागू अस्थायी आदेश।" },
  { group: "Orders & results", t: "Acquittal / conviction", hi: "दोषमुक्ति / दोषसिद्धि", en: "Acquittal: the accused is found not guilty. Conviction: found guilty.", hiText: "दोषमुक्ति: आरोपी निर्दोष पाया गया; दोषसिद्धि: दोषी पाया गया।" },
  { group: "Orders & results", t: "Disposed of", hi: "निस्तारित", en: "The case is finished in that court (it may be allowed, dismissed or closed).", hiText: "उस कोर्ट में मामला समाप्त (मंज़ूर, ख़ारिज या बंद)।" },
  { group: "Orders & results", t: "Dismissed / allowed", hi: "ख़ारिज / स्वीकार", en: "Dismissed: the request is refused. Allowed: the request is granted.", hiText: "ख़ारिज: मांग अस्वीकार; स्वीकार: मांग मंज़ूर।" },
  { group: "Orders & results", t: "Appeal / revision", hi: "अपील / पुनरीक्षण", en: "Asking a higher court to change a lower court's decision, within a time limit.", hiText: "समय सीमा में ऊपरी कोर्ट से निचली कोर्ट का फ़ैसला बदलवाने की मांग।" },
  { group: "Orders & results", t: "Quashing", hi: "रद्द करना", en: "A High Court cancelling an FIR or criminal case, usually because it shows no offence or is an abuse of law.", hiText: "हाईकोर्ट द्वारा FIR या आपराधिक मामले को रद्द करना।" },

  // People & papers
  { group: "People & papers", t: "Petitioner / respondent", hi: "याचिकाकर्ता / प्रतिवादी", en: "Petitioner: the person who files the case. Respondent: the person against whom it is filed.", hiText: "याचिकाकर्ता: मामला दायर करने वाला; प्रतिवादी: जिसके ख़िलाफ़ दायर हुआ।" },
  { group: "People & papers", t: "Plaintiff / defendant", hi: "वादी / प्रतिवादी", en: "The same roles in a civil suit: plaintiff files it, defendant defends it.", hiText: "दीवानी मुकदमे में वादी मुकदमा करता है, प्रतिवादी बचाव करता है।" },
  { group: "People & papers", t: "Complainant", hi: "शिकायतकर्ता", en: "The person who reports the crime or files the criminal complaint.", hiText: "अपराध की सूचना या आपराधिक शिकायत देने वाला व्यक्ति।" },
  { group: "People & papers", t: "Public prosecutor", hi: "लोक अभियोजक", en: "The government lawyer who conducts the criminal case for the State.", hiText: "सरकारी वकील जो राज्य की ओर से आपराधिक मुकदमा चलाता है।" },
  { group: "People & papers", t: "Surety", hi: "ज़मानतदार", en: "A person who promises the court that the accused will appear, and may lose money if they don't.", hiText: "व्यक्ति जो कोर्ट को भरोसा देता है कि आरोपी हाज़िर होगा।" },
  { group: "People & papers", t: "Advocate-on-Record (AOR)", hi: "एडवोकेट-ऑन-रिकॉर्ड", en: "An advocate qualified to file cases in the Supreme Court of India.", hiText: "सुप्रीम कोर्ट में मामले दायर करने के लिए योग्य वकील।" },
];

const GROUPS: Group[] = ["Police & criminal", "Court process", "Civil & family", "Orders & results", "People & papers"];

export default function LegalWordsPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group | "All">("All");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return WORDS.filter((w) => (group === "All" || w.group === group)
      && (!s || [w.t, w.hi, w.en, w.hiText].some((x) => x.toLowerCase().includes(s))));
  }, [q, group]);

  return (
    <>
      <PageHeader title="Legal words" subtitle="Common words you will hear in police stations and courts, in simple English and Hindi." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: bail, ज़मानत, summons…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["All", ...GROUPS] as const).map((g) => (
            <button key={g} onClick={() => setGroup(g)} aria-pressed={group === g}
              className={group === g ? "rounded-full bg-brand px-3 py-1 text-xs text-brand-ink" : "rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:text-ink"}>{g}</button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((w) => (
          <Card key={w.t}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-ink">{w.t}</h2>
              <span className="text-sm text-accent-ink">{w.hi}</span>
            </div>
            <p className="mt-2 text-sm text-ink">{w.en}</p>
            <p className="mt-1.5 text-sm text-ink-2">{w.hiText}</p>
            <div className="mt-2"><Badge>{w.group}</Badge></div>
          </Card>
        ))}
        {!shown.length && <p className="text-sm text-ink-2">No word found. Try “Ask about the law” for anything else.</p>}
      </div>
      <div className="mt-6"><NotAdvice>Meanings are simplified to help you follow your case. The exact legal meaning depends on the law and the facts; ask your advocate when it matters.</NotAdvice></div>
    </>
  );
}
