export class SchoolReportError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const textFilter = (value, max = 256) => {
  if (value == null || value === 'null' || value === 'undefined') return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new SchoolReportError('NR_INVALID_FILTER');
  return value.trim();
};
export function schoolReportFilters(query = {}) {
  const supervisorId = textFilter(query.supervisorId, 24), districtStateId = textFilter(query.districtStateId, 24);
  for (const id of [supervisorId, districtStateId]) if (id && !/^[a-f\d]{24}$/i.test(id)) throw new SchoolReportError('NR_INVALID_FILTER');
  const status = textFilter(query.status, 16), search = textFilter(query.search);
  if (status && !['Active', 'In-Active'].includes(status)) throw new SchoolReportError('NR_INVALID_FILTER');
  return { supervisorId, districtStateId, status, search };
}
export function schoolReportSearch(row, search) {
  const needle = search.toLowerCase();
  return !needle || ['code', 'nameEnglish', 'address', 'districtState', 'city', 'active', 'supervisorCode', 'supervisorName']
    .some(key => String(row[key] ?? '').toLowerCase().includes(needle));
}
