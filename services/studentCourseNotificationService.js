const headings = {
  en: ["Course fee difference", "Old fee", "New fee", "Difference", "No invoice created"],
  ta: ["பாடநெறிக் கட்டண வேறுபாடு", "பழைய கட்டணம்", "புதிய கட்டணம்", "வேறுபாடு", "கட்டணக் கேட்பு உருவாக்கப்படவில்லை"],
  ur: ["کورس کی فیس کا فرق", "پرانی فیس", "نئی فیس", "فرق", "انوائس نہیں بنایا گیا"],
  ar: ["فرق رسوم الدورة", "الرسوم السابقة", "الرسوم الجديدة", "الفرق", "لم تُنشأ فاتورة"],
  ml: ["കോഴ്സ് ഫീസിലെ വ്യത്യാസം", "പഴയ ഫീസ്", "പുതിയ ഫീസ്", "വ്യത്യാസം", "ഇൻവോയ്സ് സൃഷ്ടിച്ചിട്ടില്ല"],
  kn: ["ಕೋರ್ಸ್ ಶುಲ್ಕದ ವ್ಯತ್ಯಾಸ", "ಹಳೆಯ ಶುಲ್ಕ", "ಹೊಸ ಶುಲ್ಕ", "ವ್ಯತ್ಯಾಸ", "ಇನ್‌ವಾಯ್ಸ್ ರಚಿಸಿಲ್ಲ"],
  te: ["కోర్సు రుసుము తేడా", "పాత రుసుము", "కొత్త రుసుము", "తేడా", "ఇన్వాయిస్ సృష్టించలేదు"],
};
const shorten = (value, limit) => Array.from(String(value || "")).slice(0, limit).join("");
export function courseDifferenceNotification(language, values) {
  const [title, oldLabel, newLabel, differenceLabel, note] = headings[language] || headings.en;
  const amount = (paise) => `INR ${(paise / 100).toFixed(2)}`;
  const message = `${shorten(values.studentName,30)} (${shorten(values.rollNumber,24)}) | ${shorten(values.schoolCode,20)} | ${shorten(values.acYear,20)} | ${shorten(values.oldSlot.courseCode,18) || "—"} → ${shorten(values.newSlot.courseCode,18) || "—"} | ${oldLabel}: ${amount(values.oldSlot.netPaise)} | ${newLabel}: ${amount(values.newSlot.netPaise)} | ${differenceLabel}: ${amount(values.differencePaise)} | ${shorten(values.actorName,25)} | ${note}`;
  return { title, message };
}
