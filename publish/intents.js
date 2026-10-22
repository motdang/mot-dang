/* What a reader asks for besides the thing itself (Nan, 2026-10-04: "all of
 * them, wire up the 13 too").
 *
 * fleetsearch.js already lifts near me, open now, a price and buy. This file
 * holds the rest, in three kinds:
 *
 *   prefer  the words leave the match and rows that carry the thing rank
 *           first: a facet recorded on the place (data/facets.json keys, as
 *           the crawler copies them into pages.rich), a schedule open at the
 *           asked-for time (keys.sk), a has-bit, the words themselves. The
 *           rest of the answer stays, after them. "halal khao soi" is khao
 *           soi, the halal ones first.
 *   shelf   the word stays in the match, put in the form the thesaurus links
 *           across languages: "fix" and "broken" → repair (ซ่อม), "who buys"
 *           → รับซื้อ.
 *   lead    a line with a link above the results: the emergency numbers,
 *           the weather pages, the listings board, the route planner.
 *
 * The first thirteen take their words from searchcore's INTENT_RULES, the
 * lists the place search reads, so the two boxes hear the same words. */
import { INTENT_RULES } from "./searchcore.js";

const rule = (name, value) => {
  const r = INTENT_RULES.find(([n, v]) => n === name && v === value);
  return r ? r[2].slice() : [];
};

/* Minutes of the week (Monday 00:00 = 0) a schedule must be open at least one
 * of, for each time a reader can ask about. */
const DAY = 1440;
const at = (days, hours) => days.flatMap((d) => hours.map((h) => d * DAY + Math.round(h * 60)));
const ALL = [0, 1, 2, 3, 4, 5, 6];
export const WHEN = {
  late: at(ALL, [22.5, 23.5]),
  early: at(ALL, [6.5]),
  monday: at([0], [8, 11, 14, 17, 20]),
  tuesday: at([1], [8, 11, 14, 17, 20]),
  wednesday: at([2], [8, 11, 14, 17, 20]),
  thursday: at([3], [8, 11, 14, 17, 20]),
  friday: at([4], [8, 11, 14, 17, 20]),
  sunday: at([6], [8, 11, 14, 17, 20]),
  weekend: at([5, 6], [8, 11, 14, 17, 20]),
};

export const INTENTS = [
  /* ---- leads first: their phrases hold words the others would take */
  { id: "urgent", kind: "lead", keep: true,
    pats: ["emergency", "ambulance", "urgent help", "sos", "call an ambulance",
           "ฉุกเฉิน", "เหตุฉุกเฉิน", "ช่วยด้วย", "รถพยาบาล", "เจ็บป่วยฉุกเฉิน", "เรียกรถพยาบาล"] },
  { id: "route", kind: "lead",
    pats: ["how to get to", "how do i get to", "how can i get to", "directions to", "route to",
           "ไปยังไง", "ไปทางไหน", "ไปอย่างไร"],
    front: ["เส้นทางไป", "ทางไป", "วิธีไป"] },
  { id: "weather", kind: "lead", keep: true,
    pats: ["weather", "forecast", "will it rain", "is it raining", "rain today", "raining",
           "air quality", "aqi", "pm2.5", "pm 2.5", "pm25", "haze", "smoke today", "smoky",
           "flood", "flooding", "floods",
           "temperature", "umbrella", "sunny", "rain", "rainy", "humid", "humidity", "windy", "storm",
           "degrees", "sunscreen", "cloudy", "fog", "foggy", "is it hot", "is it cold",
           "สภาพอากาศ", "พยากรณ์อากาศ", "อากาศ", "อุณหภูมิ", "ฝน", "แดด", "ร่ม", "หนาว", "พายุ", "หมอก",
           "องศา", "ความชื้น", "ครีมกันแดด", "ฝุ่น", "หมอกควัน", "น้ำท่วม"],
    unless: /\b(play|song|playlist|recipe|rain ?tree|rain ?forest)\b/i,
    bad: ["ดูดฝุ่น", "อากาศยาน", "ร่มเกล้า", "ร่มรื่น", "ร่มเย็น", "ฝนทอง"] },
  /* ---- MASSIVE 1.1 (Amazon, CC BY 4.0) read 2026-10-04: requests a place
   * search gets that nothing here heard. Heard and kept: a line, not a cut. */
  { id: "transit", kind: "lead", keep: true,
    pats: ["train", "trains", "bus", "buses", "next train", "next bus", "train times", "bus times", "timetable",
           "train station", "bus station", "bus terminal", "departure", "departures", "flight", "flights",
           "airport", "minivan",
           "รถไฟ", "รถเมล์", "รถบัส", "รถทัวร์", "รถตู้", "ตารางรถ", "ตารางเดินรถ", "เที่ยวรถ",
           "สถานีขนส่ง", "บขส", "เที่ยวบิน", "สนามบิน", "เครื่องบิน", "ท่าอากาศยาน"],
    unless: /\b(train my|training|trainer|radio)\b|วิทยุ|คลื่น/i },
  { id: "taxi", kind: "lead", keep: true,
    pats: ["taxi", "taxis", "cab", "uber", "grab", "bolt", "a ride", "ride to", "pick me up", "tuk tuk", "tuktuk",
           "songthaew", "red truck",
           "แท็กซี่", "แทกซี่", "เรียกรถ", "แกร็บ", "แกรบ", "อูเบอร์", "โบลท์", "รถแดง", "สองแถว",
           "ตุ๊กตุ๊ก", "วินมอเตอร์ไซค์", "มอเตอร์ไซค์รับจ้าง"],
    unless: /\bgrab (a|some|lunch|dinner|breakfast|food|coffee)\b/i },
  { id: "traffic", kind: "lead", keep: true,
    pats: ["traffic", "traffic jam", "congestion", "congested", "road conditions", "road closed", "roadworks",
           "road works", "การจราจร", "จราจร", "รถติด", "ถนนปิด", "ปิดถนน", "ซ่อมถนน"] },
  { id: "events", kind: "lead", keep: true,
    pats: ["events", "event", "what's on", "whats on", "what's happening", "whats happening", "happening",
           "going on", "things to do", "something to do", "festival", "festivals", "concert", "concerts",
           "live music", "exhibition",
           "อีเวนต์", "อีเว้นท์", "อีเว้นต์", "อีเวนท์", "กิจกรรม", "เทศกาล", "คอนเสิร์ต", "มีงาน",
           "งานแสดง", "นิทรรศการ", "ทำอะไรดี", "เที่ยวไหนดี", "ไปไหนดี"],
    unless: /\b(my|calendar|remind|meeting)\b|ปฏิทิน|เตือน|ของฉัน/i,
    bad: ["รายงาน"] },
  { id: "money", kind: "lead", keep: true,
    pats: ["exchange rate", "exchange rates", "currency", "money exchange", "exchange money", "forex",
           "dollar", "dollars", "euro", "euros", "usd",
           "อัตราแลกเปลี่ยน", "แลกเงิน", "ค่าเงิน", "สกุลเงิน", "ดอลลาร์", "ยูโร", "เยน", "หยวน"],
    unless: /\b(stock|share|shares|store|shop|tree)\b|หุ้น/i },
  { id: "rent", kind: "lead", keep: true,
    pats: [["for rent", "rent"], ["to rent", "rent"], ["for lease", "rent"], ["monthly rent", "rent"],
           ["to let", "rent"], ["for sale", "sale"], ["to buy", "buy"],
           "rent", "rental", "rentals", "renting", "lease", "leasing", "leasehold", "freehold", "sublet", "sublease",
           "sale", "sell", "selling", "buy", "buying", "purchase", "takeover", "take over",
           "real estate", "realestate", "realtor", "realty", "estate agent", "property", "properties",
           "long term", "long-term", "long stay", "monthly", "per month", "a month",
           "move to", "moving to", "relocate", "relocating", "where to live", "place to live", "places to live",
           "somewhere to live",
           "ให้เช่า", "เช่า", "เช่ารายเดือน", "รายเดือน", "เซ้ง", "ขาย", "ซื้อ", "อสังหา", "นายหน้า",
           "ระยะยาว", "ย้ายมา",
           /* a home named on its own is asked for too */
           "condo", "condos", "condominium", "condominiums", "apartment", "apartments", "townhouse", "townhome",
           "dorm", "dorms", "dormitory", "moobaan", "mooban", "chanote", "title deed", "land plot", "shophouse",
           "คอนโด", "คอนโดมิเนียม", "อพาร์ทเมนท์", "อพาร์ตเมนต์", "อพาร์ทเม้นท์", "หอพัก", "ห้องเช่า", "บ้านเช่า",
           "ทาวน์เฮาส์", "ทาวน์เฮ้าส์", "ทาวน์โฮม", "ที่ดิน", "โฉนด", "บ้านเดี่ยว", "บ้านจัดสรร", "หมู่บ้านจัดสรร",
           "ตึกแถว", "อาคารพาณิชย์"],
    bad: ["ร้านขาย", "ขายส่ง", "ขายปลีก", "รับซื้อ", "สั่งซื้อ", "ซื้อกลับบ้าน", "หาซื้อ", "ซื้อของ", "ขายของ"] },
  { id: "homehelp", kind: "lead", keep: true,
    pats: ["maid", "maids", "housekeeper", "housekeepers", "housekeeping", "house keeper", "cleaner", "cleaners",
           "cleaning", "cleaning lady", "house cleaning", "home cleaning", "deep clean", "deep cleaning",
           "domestic help", "domestic helper", "home help", "household help", "helper", "live-in", "live in",
           "gardener", "gardeners", "gardening", "landscaper", "landscaping", "lawn", "grass cutting", "mow",
           "mowing", "yard work", "tree trimming", "pool cleaning", "pool cleaner",
           "laundry", "laundry pickup", "laundry delivery", "laundry service", "wash and fold", "ironing",
           "handyman", "handymen", "handy man", "odd jobs", "plumber", "plumbing", "electrician", "leak",
           "leaking", "aircon cleaning", "air con cleaning", "ac cleaning", "aircon service", "painter",
           "carpenter", "water pump", "drain", "blocked drain",
           "แม่บ้าน", "ทำความสะอาด", "คนทำความสะอาด", "แม่บ้านรายวัน", "แม่บ้านประจำ", "คนสวน", "จัดสวน",
           "ตัดหญ้า", "ตัดต้นไม้", "ซักรีด", "ซักผ้า", "รีดผ้า", "รับส่งผ้า", "ช่างซ่อมบ้าน", "ซ่อมบ้าน",
           "ช่างประปา", "ช่างไฟ", "ช่างแอร์", "ล้างแอร์", "ช่างทาสี", "ช่างไม้", "ปั๊มน้ำ", "ท่อตัน", "รั่ว",
           "คนช่วยงานบ้าน", "งานบ้าน"],
    unless: /\bmaid ?caf|\bdry cleaning\b|\bteeth cleaning\b|\bcleaning (supplies|products)\b|\bhelper (app|tool)\b/i,
    bad: ["ซักแห้ง", "รั่วไหล"] },

  /* ---- shelves: the word stays, in the form the thesaurus knows */
  { id: "fix", kind: "shelf", shelf: "repair",
    pats: ["fix", "fixing", "broken", "repairs", "repairing", "mend", "not working",
           "เสีย", "พัง", "ซ่อมแซม"] },
  { id: "sell", kind: "shelf", shelf: "รับซื้อ",
    pats: ["who buys", "where to sell", "where can i sell", "sell my", "selling my", "cash for",
           "we buy", "buyer of", "อยากขาย", "จะขาย", "ขายต่อ"] },

  /* ---- the thirteen searchcore already lists */
  { id: "late", kind: "prefer", pats: rule("open", "late"), when: "late", fac: ["open24", "latenight", "openlate"],
    th: "เปิดดึก — ที่เปิดดึกขึ้นก่อน", en: "open late — places open late first" },
  { id: "early", kind: "prefer", pats: rule("open", "early"), when: "early",
    th: "เปิดเช้า — ที่เปิดเช้าขึ้นก่อน", en: "open early — places open early first" },
  { id: "sunday", kind: "prefer", pats: rule("open", "sunday"), when: "sunday", words: ["sunday", "วันอาทิตย์"],
    th: "วันอาทิตย์ — ที่เปิดวันอาทิตย์ขึ้นก่อน", en: "Sunday — places open on Sunday first" },
  /* the weekdays, as Sunday: "museum open monday" asked for a tag page (2026-10-22) */
  { id: "monday", kind: "prefer", pats: ["open monday", "on monday", "mondays", "open on monday", "เปิดวันจันทร์", "วันจันทร์"], when: "monday",
    words: ["monday", "วันจันทร์"], th: "วันจันทร์ — ที่เปิดวันจันทร์ขึ้นก่อน", en: "Monday — places open on Monday first" },
  { id: "tuesday", kind: "prefer", pats: ["open tuesday", "on tuesday", "tuesdays", "open on tuesday", "เปิดวันอังคาร", "วันอังคาร"], when: "tuesday",
    words: ["tuesday", "วันอังคาร"], th: "วันอังคาร — ที่เปิดวันอังคารขึ้นก่อน", en: "Tuesday — places open on Tuesday first" },
  { id: "wednesday", kind: "prefer", pats: ["open wednesday", "on wednesday", "wednesdays", "open on wednesday", "เปิดวันพุธ", "วันพุธ"], when: "wednesday",
    words: ["wednesday", "วันพุธ"], th: "วันพุธ — ที่เปิดวันพุธขึ้นก่อน", en: "Wednesday — places open on Wednesday first" },
  { id: "thursday", kind: "prefer", pats: ["open thursday", "on thursday", "thursdays", "open on thursday", "เปิดวันพฤหัสบดี", "วันพฤหัสบดี", "วันพฤหัส", "เปิดวันพฤหัส"], when: "thursday",
    words: ["thursday", "วันพฤหัสบดี"], th: "วันพฤหัสบดี — ที่เปิดวันพฤหัสบดีขึ้นก่อน", en: "Thursday — places open on Thursday first" },
  { id: "friday", kind: "prefer", pats: ["open friday", "on friday", "fridays", "open on friday", "เปิดวันศุกร์", "วันศุกร์"], when: "friday",
    words: ["friday", "วันศุกร์"], th: "วันศุกร์ — ที่เปิดวันศุกร์ขึ้นก่อน", en: "Friday — places open on Friday first" },
  { id: "weekend", kind: "prefer", pats: rule("open", "weekend"), when: "weekend", words: ["weekend", "เสาร์อาทิตย์"],
    th: "สุดสัปดาห์ — ที่เปิดเสาร์-อาทิตย์ขึ้นก่อน", en: "weekend — places open at the weekend first" },
  { id: "best", kind: "prefer", score: true,
    pats: rule("rank", "best").concat(["recommend", "recommended", "suggest", "suggestions", "what should i",
           "where should i", "ที่ไหนดี", "อะไรดี", "ไหนดี", "น่าไป"]),
    front: ["แนะนำ"], bad: ["คำแนะนำ"],
    unless: /\bgood (morning|night|afternoon|evening|luck)\b|\bmy favou?rite\b|\btop[ -]?up\b|\btop (news|headlines)\b/i,
    th: "ดีที่สุด — ที่มีข้อมูลมากขึ้นก่อน", en: "best — the fullest listings first" },
  { id: "vegetarian", kind: "prefer", pats: rule("diet", "vegetarian"), fac: ["vegoption"],
    words: ["vegetarian", "มังสวิรัติ", "vegan", "เจ"],
    th: "มังสวิรัติ — ที่ระบุว่ามีเมนูมังสวิรัติขึ้นก่อน", en: "vegetarian — places that say vegetarian first" },
  { id: "vegan", kind: "prefer", pats: rule("diet", "vegan").concat(["plant based"]), fac: ["vegoption"],
    words: ["vegan", "วีแกน", "เจ", "อาหารเจ", "plant based"], bad: ["ซีเจ"],
    th: "เจ · วีแกน — ที่ระบุว่าเจหรือวีแกนขึ้นก่อน", en: "vegan — places that say vegan first" },
  { id: "halal", kind: "prefer", pats: rule("diet", "halal"), fac: ["halal"],
    words: ["halal", "ฮาลาล", "muslim", "มุสลิม"],
    th: "ฮาลาล — ที่ระบุว่าฮาลาลขึ้นก่อน", en: "halal — places that say halal first" },
  { id: "wheelchair", kind: "prefer", pats: rule("access", "wheelchair"), fac: ["wheelchair"],
    words: ["wheelchair", "step free", "รถเข็น", "วีลแชร์", "ทางลาด"],
    th: "รถเข็น — ที่บันทึกว่าเข้าได้ไม่มีขั้นขึ้นก่อน", en: "wheelchair — places recorded step-free first" },
  { id: "parking", kind: "prefer", pats: rule("access", "parking"), fac: ["parking"],
    words: ["parking", "car park", "ที่จอดรถ", "ลานจอดรถ"],
    th: "ที่จอดรถ — ที่มีที่จอดขึ้นก่อน", en: "parking — places with parking first" },
  { id: "english", kind: "prefer", pats: rule("access", "english"), fac: ["english", "engmedium", "epmep"],
    words: ["english spoken", "speaks english", "พูดภาษาอังกฤษ", "พูดอังกฤษ", "คุยอังกฤษได้"],
    th: "พูดอังกฤษ — ที่ระบุว่าพูดอังกฤษได้ขึ้นก่อน", en: "English spoken — places that say so first" },
  { id: "kids", kind: "prefer", pats: rule("kids", "yes"), fac: ["kids"],
    words: ["kids", "children", "family", "เด็ก", "ครอบครัว"],
    th: "พาเด็ก — ที่รับเด็กขึ้นก่อน", en: "kids — places for children first" },
  { id: "pets", kind: "prefer", pats: rule("pets", "yes"), fac: ["pets"],
    words: ["pet friendly", "dog friendly", "pets allowed", "สัตว์เลี้ยง"],
    th: "สัตว์เลี้ยง — ที่ให้พาสัตว์เลี้ยงขึ้นก่อน", en: "pets — places that take pets first" },
  { id: "wifi", kind: "prefer", pats: rule("wifi", "yes"), fac: ["wifi"],
    words: ["wifi", "wi fi", "ไวไฟ"],
    th: "ไวไฟ — ที่มีไวไฟขึ้นก่อน", en: "wifi — places with wifi first" },
  { id: "aircon", kind: "prefer", pats: rule("aircon", "yes"), fac: ["aircon"],
    words: ["air conditioned", "aircon", "แอร์เย็น", "ห้องแอร์", "มีแอร์"],
    th: "มีแอร์ — ที่มีแอร์ขึ้นก่อน", en: "air-con — air-conditioned places first" },
  { id: "delivery", kind: "prefer", fac: ["delivery"],
    pats: rule("delivery", "yes").concat(["deliver", "delivered", "take-out", "takeout", "take out", "carry-out",
           "carryout", "food delivery", "order food", "ซื้อกลับบ้าน", "กลับบ้านได้", "บริการส่ง", "ส่งอาหาร",
           "สั่งอาหาร", "เดลิเวอรี่", "ดิลิเวอรี่", "ไลน์แมน", "ฟู้ดแพนด้า", "แกร็บฟู้ด"]),
    words: ["delivery", "เดลิเวอรี", "ส่งถึงบ้าน", "ส่งถึงที่"],
    th: "ส่งถึงที่ — ที่มีส่งขึ้นก่อน", en: "delivery — places that deliver first" },
  { id: "walkin", kind: "prefer", pats: rule("appointment", "walkin"), fac: ["walkin", "sameday", "walkintable"],
    words: ["walk in", "walk ins", "วอล์กอิน", "ไม่ต้องจอง"],
    th: "เดินเข้าได้ — ที่ไม่ต้องนัดขึ้นก่อน", en: "walk-in — places that take walk-ins first" },
  { id: "bigsize", kind: "prefer", pats: rule("size", "big"), fac: ["bigsizes"],
    words: ["big size", "plus size", "ไซส์ใหญ่", "ไซซ์ใหญ่", "บิ๊กไซส์"],
    th: "ไซส์ใหญ่ — ที่ระบุไซส์ใหญ่ขึ้นก่อน", en: "big sizes — places that say so first" },

  /* ---- the new ones that rank rather than lead */
  { id: "book", kind: "prefer", fac: ["booking", "sameday", "privateclass"],
    pats: ["book a table", "book a", "to book", "booking", "bookings", "reserve", "reservation",
           "reservations", "ticket", "tickets", "จอง", "จองโต๊ะ", "จองตั๋ว", "สำรองที่นั่ง", "ตั๋ว",
           "ซื้อตั๋ว", "หาตั๋ว"],
    front: ["จองโต๊ะ", "จอง"],
    words: ["booking", "reservation", "tickets", "จอง", "ตั๋ว"],
    th: "จอง — ที่รับจองขึ้นก่อน", en: "booking — places that take bookings first" },
  { id: "price", kind: "prefer", fac: ["priceboard"],
    pats: ["how much", "how much is", "how much does", "price of", "prices", "price list", "price",
           "cost", "costs", "fee", "fees", "rates", "entrance fee",
           "ราคาเท่าไหร่", "ราคาเท่าไร", "กี่บาท", "ค่าเข้า", "ราคา"],
    unless: /how much (snow|rain|time|longer|water|sugar)/i,
    words: ["price", "baht", "ราคา", "บาท"],
    th: "ราคา — หน้าที่บอกราคาขึ้นก่อน", en: "price — pages that give a price first" },
  { id: "howto", kind: "prefer", page: true,
    pats: ["how to", "how do", "how does", "why is", "why do", "guide to", "explain", "define", "definition",
           "meaning of", "what does", "describe",
           "ทำยังไง", "ทำอย่างไร", "คืออะไร", "ยังไง", "แปลว่า", "ความหมาย", "คำจำกัดความ", "นิยาม", "หมายถึง",
           "หมายความว่า"],
    front: ["วิธีการ", "วิธี", "อะไรคือ", "ทำไม", "อธิบาย"],
    th: "วิธี — หน้าอธิบายขึ้นก่อน", en: "how to — explainers and guides first" },
  { id: "free", kind: "prefer", fac: ["toiletfree", "pickupfree"],
    pats: ["free", "for free", "free entry", "free admission", "no charge", "no fee",
           "ฟรี", "เข้าฟรี", "ไม่เสียเงิน", "ไม่มีค่าใช้จ่าย", "ไม่เสียค่าเข้า"],
    words: ["free", "ฟรี"],
    unless: /(gluten|sugar|duty|smoke|alcohol|dairy|lactose|cruelty|tax|nut|hands)[ -]free|\b(am i|are you|be) free\b|\bfree (time|tonight|today|tomorrow)\b/i,
    th: "ฟรี — ที่บอกว่าฟรีขึ้นก่อน", en: "free — places that say free first" },
  { id: "learn", kind: "prefer", fac: ["privateclass", "eveningclass", "multiday", "engmedium"],
    pats: ["learn", "learning", "learn to", "learn how to", "อยากเรียน"],
    front: ["อยากเรียน", "เรียน"],
    words: ["class", "course", "lesson", "school", "workshop", "เรียน", "คอร์ส", "สอน", "คลาส", "โรงเรียน"],
    th: "เรียน — ที่สอนขึ้นก่อน", en: "learn — classes and courses first" },
  { id: "work", kind: "lead", keep: true,
    pats: ["jobs", "job", "hiring", "vacancy", "vacancies", "employment", "work", "looking for work",
           "find work", "part time", "part-time",
           "รับสมัครงาน", "รับสมัคร", "หางาน", "สมัครงาน", "ตำแหน่งว่าง", "รับจ้าง", "รับงาน", "งานพาร์ทไทม์"],
    unless: /\b(work ?out|workshop|network|homework|artwork|framework|does it work|how .* work)\b/i },
  { id: "hours", kind: "prefer", has: "hours",
    pats: ["what time does", "when does", "opening hours", "opening times", "open until", "closing time",
           "hours", "เปิดกี่โมง", "ปิดกี่โมง", "เวลาเปิด", "เวลาเปิดปิด", "เวลาทำการ"],
    unless: /alarm|remind|meeting|appointment|calendar|ปลุก|เตือน|นัด/i,
    th: "เวลาเปิด — ที่มีเวลาเปิดขึ้นก่อน", en: "hours — places with hours listed first" },
  { id: "contact", kind: "prefer", has: "contact",
    unless: /contact lens|รายชื่อติดต่อ|ผู้ติดต่อ|\bmy contacts?\b/i,
    pats: ["phone number", "phone no", "telephone number", "contact number", "contact details", "line id",
           "whatsapp", "เบอร์โทร", "เบอร์ติดต่อ", "ติดต่อ", "ไลน์ไอดี", "ช่องทางติดต่อ"],
    th: "ติดต่อ — ที่มีช่องทางติดต่อขึ้นก่อน", en: "contact — places with a way to reach them first" },
];

/* Lines and links for the lead kinds. Numbers as Safety First prints them
 * (motdang.net/sites/safety/, read 2026-10-04). */
const SAFETY = "/sites/safety/";
export const LEADS = {
  urgent: {
    th: "ฉุกเฉิน", en: "emergency",
    links: [["tel:1669", "1669 รถพยาบาล · ambulance"], ["tel:191", "191 ตำรวจ · police"],
            ["tel:199", "199 ดับเพลิง · fire"], ["tel:1155", "1155 ตำรวจท่องเที่ยว · police, English spoken"],
            ["tel:1784", "1784 สาธารณภัย · disaster"], [SAFETY, "ความปลอดภัย · Safety First"]],
  },
  weather: {
    th: "อากาศ", en: "weather",
    links: [["/", "ฟ้าและพยากรณ์ · sky and forecast"],
            ["https://nanobotco.github.io/rain-chiang-mai/", "ฝนตอนนี้ · rain radar"],
            ["/sites/smoky-season/", "ฝุ่นและควัน · smoke and haze"],
            [SAFETY + "#river", "ระดับน้ำปิง · Ping river level"]],
  },
  rent: {
    th: "ประกาศขาย-เช่า", en: "property listings",
    links: [["/listings/", "ประกาศเช่า-ขาย · listings"], ["/listings/register/", "ทะเบียนตึก · building register"],
            ["/listings/join", "ลงประกาศ · list a property"]],
  },
  homehelp: {
    th: "งานบ้าน", en: "home help",
    links: [["/home-help/?near=1", "แม่บ้าน คนสวน ซักรีด ช่าง ใกล้ฉัน · housekeepers, gardeners, laundry, handymen near you"],
            ["/home-help/join", "ลงชื่อรับงาน · list yourself"]],
  },
  work: {
    th: "งาน", en: "work",
    links: [["/home-help/join", "ลงชื่อรับงานบ้าน · list yourself for home work"],
            ["/home-help/", "แม่บ้านและช่างลงชื่อ · home help board"]],
  },
  transit: {
    th: "เดินทาง", en: "getting around",
    links: [["/cm/transport/bus/index.html", "รถเมล์-รถทัวร์ · buses"], ["/cm/transport/train/index.html", "รถไฟ · trains"],
            ["/cm/transport/airport/index.html", "สนามบิน · airport"], ["/plan.html", "วางแผนเส้นทาง · plan a route"]],
  },
  traffic: {
    th: "จราจร", en: "traffic",
    links: [["/", "ถนนตอนนี้ · roads now, front page"], ["/roadworks/", "งานถนน · roadworks"]],
  },
  events: {
    th: "งาน", en: "events",
    links: [["/#day=", "ปฏิทินวันนี้ · today's calendar"], ["/full-moon", "วันพระ · full moon at the wat"]],
  },
  money: {
    th: "แลกเงิน", en: "money exchange",
    links: [["/find?q=money+exchange&sort=near", "ร้านแลกเงินใกล้สุด · exchange counters, nearest"]],
  },
};
/* Grab's own link (build.py grab_ride_url): the drop-off filled in when a
 * place is known, else the app's booking screen. */
const GRAB = "https://grab.onelink.me/2695613898?af_dp=";
const GRAB_WEB = "&af_web_dp=" + encodeURIComponent("https://www.grab.com/th/transport/");
export function grabUrl(place) {
  let dp = "grab://open?screenType=BOOKING";
  if (place && place.lat != null && place.lon != null) {
    dp += `&dropOffLatitude=${Number(place.lat).toFixed(6)}&dropOffLongitude=${Number(place.lon).toFixed(6)}` +
          `&dropOffAddress=${encodeURIComponent(String(place.title || "").split(/ · | — /)[0])}`;
  }
  return GRAB + encodeURIComponent(dp) + GRAB_WEB;
}
/* rent's listings line shows when the reader named a home, or nothing else
 * but the rent words. A Thai home word counts anywhere in a run (บ้านให้เช่า). */
const HOME_WORDS = /(^|\s)(house|houses|home|homes|condo|condos|condominium|room|rooms|apartment|apartments|flat|flats|studio|villa|villas|bungalow|land|plot|rai|townhouse|townhome|shophouse|office|space|property|properties|real estate|realestate|dorm|dorms|dormitory|mansion|moobaan|mooban|guesthouse|hostel|business|warehouse|chanote|freehold|leasehold|long term|long-term|long stay|monthly|place to live|places to live|where to live|somewhere to live)(\s|$)|บ้าน|คอนโด|ห้อง|อพาร์ท|อพาร์ต|ที่ดิน|ทาวน์|ตึกแถว|อาคาร|หอพัก|แมนชั่น|โฉนด|อสังหา|เกสต์เฮ้าส์|เกสต์เฮาส์|โฮสเทล|กิจการ|โกดัง|ไร่|รายเดือน|ระยะยาว/;
const RENT_ONLY = new RegExp("^(" + ["for", "to", "a", "rent", "rental", "rentals", "renting", "lease", "leasing",
  "sale", "sell", "selling", "sublet", "sublease", "let", "takeover", "take", "over", "ให้เช่า", "เช่า", "เซ้ง", "ขาย"]
  .join("|") + "|\\s)+$", "i");

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const THAI = /[฀-๿]/;

/* Lifts every intent above from a padded query (" ... "). Returns the query
 * left over, what was heard, and the words taken out (put back by the caller
 * when nothing else is left). A Thai pattern that cuts counts standing alone
 * or at the end of a run, the rule fleetsearch.js uses for its own four; a
 * `front` pattern at the start of one (วิธีทำข้าวซอย). A `keep` intent cuts
 * nothing, so its Thai words are heard anywhere in a run (สภาพอากาศวันนี้).
 * A pattern given as [words, form] is rewritten to that form; a shelf word is
 * put back in its thesaurus form. An intent's `bad` words are hidden while it
 * reads (ดูดฝุ่น is vacuuming, not dust; ซีเจ is the CJ shop, not vegan). */
const MASK = "\u0e70";      // unassigned in the Thai block, so a run stays a run
export function liftMore(s) {
  s = s.replace(/เเ/g, "แ"); // แ typed as two เ (MASSIVE th-TH writes เเท็กซี่)
  const heard = [];
  const removed = [];
  const hear = (it, p) => { if (!heard.find((h) => h.id === it.id)) heard.push({ id: it.id, said: p }); };
  const take = (p, rep, anywhere) => {
    const re = THAI.test(p)
      ? new RegExp(`${reEsc(p)}${anywhere ? "" : "(?=[^\\u0e00-\\u0e7f]|$)"}`)
      : new RegExp(`(?<=\\s)${reEsc(p)}(?=\\s)`, "i");
    if (!re.test(s)) return false;
    if (rep !== p) s = s.replace(re, ` ${rep} `);
    return true;
  };
  /* Thai puts the route around the place: ไปวัดเจดีย์หลวงยังไง. Read before
   * the loop, or how-to would take the ยังไง. */
  const thRoute = /(^|\s)ไป([฀-๿]+?)(ยังไง|อย่างไร|ทางไหน)(?=\s|$)/;
  if (thRoute.test(s)) {
    s = s.replace(thRoute, "$1$2");
    hear(INTENTS.find((x) => x.id === "route"), "ไป…ยังไง");
  }
  for (const it of INTENTS) {
    if (it.unless && it.unless.test(s)) continue;
    const hidden = [];
    for (const w of it.bad || []) {
      s = s.split(w).join(MASK + "๐".repeat(hidden.length + 1) + MASK);
      hidden.push(w);
    }
    const pats = (it.pats || []).map((p) => (Array.isArray(p) ? p : [p, null]))
      .sort((a, b) => b[0].length - a[0].length);
    for (const [p, form] of pats) {
      const rep = form || (it.keep ? p : it.kind === "shelf" ? it.shelf : "");
      if (take(p, rep, it.keep && rep === p)) {
        hear(it, p);
        if (!rep) removed.push(p);
      }
    }
    for (const p of it.front || []) {
      const re = new RegExp(`(^|\\s)${reEsc(p)}(?=[\\u0e00-\\u0e7f])`);
      if (!re.test(s)) continue;
      s = s.replace(re, "$1");
      hear(it, p);
      removed.push(p);
    }
    for (let i = hidden.length - 1; i >= 0; i--) s = s.split(MASK + "๐".repeat(i + 1) + MASK).join(hidden[i]);
  }
  return { s, heard, removed };
}

/* What rent's lead needs to know about the words left. */
export const namesHome = (q) => HOME_WORDS.test(" " + q + " ");

/* The prefer groups for what was heard: each is one multiplier in the rank
 * and one key in the nearest order. `phrase` and `seg` are fleetsearch's, so
 * a Thai word is split the way the index split it; `scheds` is the lamp
 * schedules (id → week intervals), `openAt` the test that reads them. */
export function preferOf(heard, { phrase, seg, scheds, openAt }) {
  const out = [];
  for (const h of heard) {
    const it = INTENTS.find((x) => x.id === h.id);
    if (!it || it.kind !== "prefer") continue;
    const g = { id: it.id, fac: (it.fac || []).slice(), has: it.has || "", page: !!it.page, score: !!it.score, sk: [] };
    const words = Array.from(new Set([h.said].concat(it.words || []).filter((w) => w && !/…/.test(w))));
    const ph = words.map((w) => phrase(w, seg, false)).filter(Boolean);
    g.match = ph.length ? ph.join(" OR ") : "";
    if (it.when && scheds) {
      const mins = WHEN[it.when] || [];
      for (const [k, iv] of scheds) if (mins.some((m) => openAt(iv, m))) g.sk.push(k);
    }
    out.push(g);
  }
  return out;
}

/* One line per intent heard: what the box did with it. A prefer line only
 * while the order is best match or nearest, the two orders it moves. */
export function saidOf(heard, ranked) {
  const out = [];
  for (const h of heard) {
    const it = INTENTS.find((x) => x.id === h.id);
    if (!it) continue;
    if (it.th) { if (ranked !== false) out.push(`${it.th} · ${it.en}`); }
    else if (it.kind === "shelf") out.push(it.id === "fix" ? "ซ่อม · repair" : "รับซื้อ · who buys");
  }
  return out;
}

/* One lead: its words and links, or null. `top` is the first Mot Dang place
 * result (route planner, Grab drop-off), `q` the words left, `today` the
 * Chiang Mai date. */
const PLACE = /^https:\/\/motdang\.net\/(cm|cr)\/p\/([^/]+)\.html$/;
export function leadOf(h, { top, q, today }) {
  const name = top ? String(top.title || "").split(/ · | — /)[0] : "";
  if (h.id === "rent") return !q || namesHome(q) || RENT_ONLY.test(q) ? LEADS.rent : null;
  if (h.id === "events") {
    return { ...LEADS.events, links: LEADS.events.links.map(([u, t]) => [u === "/#day=" ? u + (today || "") : u, t]) };
  }
  if (h.id === "taxi") {
    const m = top && PLACE.exec(top.url || "");
    return { th: "เรียกรถ", en: "ride", links: [[grabUrl(m ? top : null), m ? `แกร็บไป · Grab to ${name}` : "เปิดแกร็บ · open Grab"],
                                             ["/cm/transport/index.html", "เดินทาง · transport"]] };
  }
  if (h.id === "route") {
    const m = top && PLACE.exec(top.url || "");
    return { th: "เส้นทาง", en: "route", links: m
      ? [[`/plan.html?stops=${encodeURIComponent(m[1] + ":" + m[2])}&go=1`, `นำทางไป · Guide me to ${name}`]]
      : [["/plan.html", "วางแผนเส้นทาง · plan a route"]] };
  }
  return LEADS[h.id] || null;
}

/* The lead lines, as HTML; `esc` is fleetsearch's escaper. */
export function leadHtml(heard, { top, q, today, esc }) {
  return heard.map((h) => leadOf(h, { top, q, today })).filter(Boolean).map((l) =>
    `<p class="note lead">${esc(l.th)} · ${esc(l.en)} — ` +
    l.links.map(([u, t]) => `<a href="${esc(u)}">${esc(t)}</a>`).join(" · ") + "</p>").join("");
}

/* The lead links as data, for ?fmt=json. */
export function leadJson(heard, { top, q, today, origin }) {
  const abs = (u) => (/^https?:|^tel:/.test(u) ? u : origin + u);
  return heard.map((h) => [h.id, leadOf(h, { top, q, today })]).filter(([, l]) => l)
    .map(([id, l]) => ({ intent: id, links: l.links.map(([u, t]) => ({ url: abs(u), label: t })) }));
}
