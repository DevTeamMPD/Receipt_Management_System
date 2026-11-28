// ฟิลด์ที่ขอจากโมเดล OCR และ prompt — ใช้ร่วมกันทุกผู้ให้บริการ
export const EXTRACT_FIELDS = [
  'docType', 'formTitle', 'billNumber', 'orderDateText', 'customerName', 'phone', 'address', 'subDistrict', 'district', 'province',
  'postcode', 'shipDateText', 'items', 'remark', 'total', 'posNumber', 'posTotal', 'uncertain',
];

export const PROMPT = `You read photos of Thai sales order forms ("ใบส่งซื้อสินค้า") for an office team. Return ONLY JSON.
The photo may contain a handwritten order form and, next to it, a printed POS receipt / abbreviated tax invoice.

Rules:
- Copy text exactly as written. Do NOT translate, correct, normalise or invent anything. Use "" when a value is missing or unreadable.
- Dates: copy exactly as written (for example "14/7/69" or "13 พ.ค. 69"). Do not convert Buddhist/Gregorian years. The order date is the "วันที่สั่งซื้อ" box at the top right.
- phone: the customer's phone number as written.
- address = house number / soi / road only; put sub-district (แขวง/ตำบล), district (เขต/อำเภอ), province and postcode in their own fields.
- postcode: the 5-digit postal code written at the end of the address. Read it digit by digit and copy all five digits; the office system uses it to check the area names.
- subDistrict, district, province: copy the handwritten letters as you see them, even when the result is not a place name you know. Do not replace them with a different place name — the system matches them against the postcode itself.
- address: include EVERY handwritten address line (forms often continue the address on a second line under the first). Keep house numbers like "168/28".
- items: the usual form ("Central x Bebeplay") is a table of product rows, each with "size" / "สี" (color) / "แบบ" sub-rows of checkboxes.
  Rows usually include: คอกกั้นเด็ก, เบาะ PU size, ของเล่น ชิงช้า, ของเล่น สไลเดอร์ (with an extra "แผ่นเสริมสไลเดอร์" box), เก้าอี้ High Chair (with อุปกรณ์เสริม), เตียงนอน 7 in 1, รถเข็น, Adventure สไลเดอร์, ไวท์บอร์ด+เก้าอี้ รุ่น Scribble, ม้าโยก 2in1 Foal.
  Go through the table ROW BY ROW and look at EVERY checkbox, including the right-hand columns. A box counts as ticked if it has a tick, cross or any pen mark.
  Return one item per product row that has at least one ticked box: product = the row name as printed, size = the ticked size option text, color = the ticked colour/pattern option text (empty string if none ticked).
  A ticked add-on box in a row (for example "แผ่นเสริมสไลเดอร์") is its own item with that text as product.
- total: the handwritten "รวมยอดเงิน" amount, digits only.
- If a POS receipt is visible: posNumber = its receipt number exactly as printed after "Rcpt" (for example "222 - 123456") and posTotal = the final amount paid (digits only). Otherwise "".
- uncertain: list the field names (from the JSON keys) whose value you are NOT sure about, especially hard-to-read handwriting. Never guess silently.
- docType: "order_form" if an order form is visible, "receipt_only" if only a receipt, otherwise "other".
- formTitle: the printed title in the header at the top of the document, copied exactly, together with the brand / logo text printed in the same header (for example "ใบส่งซื้อสินค้า Bebeplay"). "" if there is no printed title.

JSON keys: docType, formTitle, billNumber, orderDateText, customerName, phone, address, subDistrict, district, province, postcode, shipDateText, items [{product,size,color}], remark, total, posNumber, posTotal, uncertain [string].`;

const str = { type: 'STRING' };
export const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    docType: { type: 'STRING', enum: ['order_form', 'receipt_only', 'other'] },
    formTitle: str, billNumber: str, orderDateText: str, customerName: str, phone: str, address: str, subDistrict: str, district: str,
    province: str, postcode: str, shipDateText: str, remark: str, total: str, posNumber: str, posTotal: str,
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { product: str, size: str, color: str }, required: ['product', 'size', 'color'] } },
    uncertain: { type: 'ARRAY', items: str },
  },
  required: EXTRACT_FIELDS,
};
