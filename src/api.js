export class ApiError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, 'ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'เกิดข้อผิดพลาด', { code: data.code, fields: data.fields });
  return data;
}

export const api = {
  me: () => call('GET', '/api/auth/me'),
  login: (email, password) => call('POST', '/api/auth/login', { email, password }),
  logout: () => call('POST', '/api/auth/logout', {}),
  orders: () => call('GET', '/api/orders'),
  createOrder: (image, branch) => call('POST', '/api/orders', { image, branch }),
  save: (id, version, fields, items) => call('PATCH', `/api/orders/${id}`, { version, fields, ...(items ? { items } : {}) }),
  remove: (id, version) => call('DELETE', `/api/orders/${id}`, { version }),
  retryOcr: (id, version) => call('POST', `/api/orders/${id}/ocr`, { version }),
  lineGroups: () => call('GET', '/api/line/groups'),
  setLineGroupBranch: (groupId, branch) => call('PATCH', `/api/line/groups/${encodeURIComponent(groupId)}`, { branch }),
  act: (id, action, version, extra = {}) => call('POST', `/api/orders/${id}/${action}`, { version, ...extra }),
};
