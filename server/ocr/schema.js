// ฟิลด์ที่ขอจากโมเดล OCR และ prompt — ใช้ร่วมกันทุกผู้ให้บริการ
export const EXTRACT_FIELDS = [
  'docType', 'billNumber', 'orderDateText', 'customerName', 'phone', 'address', 'subDistrict', 'district', 'province',
  'postcode', 'shipDateText', 'items', 'remark', 'total', 'posNumber', 'posTotal', 'uncertain',
];

export const PROMPT = `You read photos of Thai sales order forms ("ใบส่งซื้อสินค้า") for an office team. Return ONLY JSON.
The photo may contain a handwritten order form and, next to it, a printed POS receipt / abbreviated tax invoice.

Rules:
- Copy text exactly as written. Do NOT translate, correct, normalise or invent anything. Use "" when a value is missing or unreadable.
- Dates: copy exactly as written (for example "14/7/69"). Do not convert Buddhist/Gregorian years.
- phone: the customer's phone number as written.
- address = house number / soi / road only; put sub-district (แขวง/ตำบล), district (เขต/อำเภอ), province and postcode in their own fields.
- items: one entry for every TICKED checkbox on the form. product = the product group printed on the form, size and color = the ticked options (empty string if none).
- total: the handwritten "รวมยอดเงิน" amount, digits only.
- If a POS receipt is visible: posNumber = its receipt number (Rcpt / TPNo) and posTotal = the final amount paid (digits only). Otherwise "".
- uncertain: list the field names (from the JSON keys) whose value you are NOT sure about, especially hard-to-read handwriting. Never guess silently.
- docType: "order_form" if an order form is visible, "receipt_only" if only a receipt, otherwise "other".

JSON keys: docType, billNumber, orderDateText, customerName, phone, address, subDistrict, district, province, postcode, shipDateText, items [{product,size,color}], remark, total, posNumber, posTotal, uncertain [string].`;

const str = { type: 'STRING' };
export const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    docType: { type: 'STRING', enum: ['order_form', 'receipt_only', 'other'] },
    billNumber: str, orderDateText: str, customerName: str, phone: str, address: str, subDistrict: str, district: str,
    province: str, postcode: str, shipDateText: str, remark: str, total: str, posNumber: str, posTotal: str,
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { product: str, size: str, color: str }, required: ['product', 'size', 'color'] } },
    uncertain: { type: 'ARRAY', items: str },
  },
  required: EXTRACT_FIELDS,
};
