import { getRolePermissions } from "./permissionService.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";
import TravelClaim from "../models/TravelClaim.js";
import Employee from "../models/Employee.js";
import Supervisor from "../models/Supervisor.js";
import { publicClaim } from "./travelClaimService.js";
import { failTa, isMonthKey, claimMonthFilter, monthlyStatus, TA_SELF_ROLES } from "../utils/travelClaimPolicy.js";

const visibleStatuses = ["Submitted", "Approved", "PayrollReserved", "Paid", "Rejected"];
const key = (row) => `${row.staffType}:${row.staffId}:${row.userId}`;
export function monthlyReportInput(query) {
  if (!isMonthKey(query.monthKey)) failTa("TA_INVALID_MONTH");
  const status = query.status || "", category = query.category || "", search = query.search || "";
  if (!["", "Submitted", "Approved", "Rejected", "Not submitted"].includes(status) || !["", "Employee", "Supervisor"].includes(category) || typeof search !== "string" || search.length > 100) failTa("TA_INVALID_FIELDS");
  return { monthKey: query.monthKey, status, category, search: search.trim().toLocaleLowerCase() };
}
export async function monthlyClaims(req, access) {
  const review = req.path === "/review";
  if (review ? !access.canReview : !access.canViewOwn) failTa("TA_FORBIDDEN", 403);
  const input = monthlyReportInput(req.query);
  if (input.status === "Not submitted") failTa("TA_INVALID_FIELDS");
  const filter = { $and: [claimMonthFilter(input.monthKey), { status: { $in: input.status ? input.status === "Approved" ? ["Approved", "PayrollReserved", "Paid"] : [input.status] : visibleStatuses } }] };
  if (!review) Object.assign(filter, { userId: req.user._id, staffType: access.actor.staffType, staffId: access.actor.staffId });
  if (input.category) filter.$and.push({ staffType: input.category });
  if (req.query.before) {
    if (!/^[a-f0-9]{24}$/i.test(String(req.query.before))) failTa("TA_INVALID_FIELDS");
    filter._id = { $lt: req.query.before };
  }
  // Search is performed as a literal substring, never as user-provided regex.
  if (input.search) {
    const escaped = input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$and.push({ $or: ["name", "staffCode", "employeeId", "supervisorId", "claimNumber"].map((field) => ({ [field]: { $regex: escaped, $options: "i" } })) });
  }
  const claims = await TravelClaim.find(filter).sort({ _id: -1 }).limit(26).lean();
  return { claims: claims.slice(0, 25).map(publicClaim), nextCursor: claims.length > 25 ? String(claims[24]._id) : null };
}
export async function monthlyReport(req, access) {
  if (!access.canReview) failTa("TA_FORBIDDEN", 403);
  const input = monthlyReportInput(req.query);
  const [employees, supervisors, claims] = await Promise.all([
    Employee.find({ organizationType: "HQ", active: "Active" }).select("userId employeeId").populate("userId", "name role").lean(),
    Supervisor.find({ active: "Active" }).select("userId supervisorId").populate("userId", "name role").lean(),
    TravelClaim.find({ $and: [claimMonthFilter(input.monthKey), { status: { $in: visibleStatuses } }] }).select("userId staffType staffId status requestedAmountPaise approvedAmountPaise").sort({ _id: -1 }).limit(10001).lean(),
  ]);
  if (claims.length > 10000 || employees.length + supervisors.length > 10000) failTa("TA_REPORT_LIMIT");
  const permissionRows = await Promise.all([...TA_SELF_ROLES].map(async (role) => [role, await getRolePermissions(role)]));
  const eligibleRoles = new Set(permissionRows.filter(([, permissions]) => permissions.includes(PERMISSIONS.TA_SELF_VIEW) && permissions.includes(PERMISSIONS.TA_SELF_MANAGE)).map(([role]) => role));
  const roster = [];
  for (const [records, staffType] of [[employees, "Employee"], [supervisors, "Supervisor"]]) for (const record of records) {
    const role = String(record.userId?.role || "").trim().toLowerCase();
    if (!record.userId?._id || !eligibleRoles.has(role) || (staffType === "Supervisor") !== (role === "supervisor")) continue;
    roster.push({ userId: String(record.userId._id), staffId: String(record._id), staffType, role, name: record.userId.name,
      employeeId: record.employeeId || "", supervisorId: record.supervisorId || "", monthKey: input.monthKey });
  }
  const byStaff = new Map();
  for (const claim of claims) {
    const group = byStaff.get(key(claim)) || []; group.push(claim); byStaff.set(key(claim), group);
  }
  const priority = { Approved: 3, Submitted: 2, Rejected: 1 };
  const rows = roster.map((staff) => {
    const group = byStaff.get(key(staff)) || [];
    const selected = [...group].sort((a, b) => priority[monthlyStatus(b.status)] - priority[monthlyStatus(a.status)])[0];
    return { ...staff, status: selected ? monthlyStatus(selected.status) : "Not submitted", claimId: selected?._id || null,
      claimCount: group.length, requestedAmountPaise: group.reduce((sum, c) => sum + Number(c.requestedAmountPaise || 0), 0),
      approvedAmountPaise: group.filter((c) => monthlyStatus(c.status) === "Approved").reduce((sum, c) => sum + Number(c.approvedAmountPaise || 0), 0) };
  });
  const summary = { eligible: rows.length, submitted: 0, approved: 0, rejected: 0, notSubmitted: 0 };
  const summaryKeys = { Submitted: "submitted", Approved: "approved", Rejected: "rejected", "Not submitted": "notSubmitted" };
  rows.forEach((row) => { summary[summaryKeys[row.status]] += 1; });
  const filtered = rows.filter((row) => (!input.category || row.staffType === input.category) && (!input.status || row.status === input.status) &&
    (!input.search || [row.name, row.employeeId, row.supervisorId].some((value) => String(value || "").toLocaleLowerCase().includes(input.search))));
  filtered.sort((a, b) => String(a.name).localeCompare(String(b.name)) || key(a).localeCompare(key(b)));
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) failTa("TA_INVALID_FIELDS");
  const exporting = req.path.endsWith("/export");
  return { monthKey: input.monthKey, summary, rows: exporting ? filtered : filtered.slice((page - 1) * 25, page * 25),
    total: filtered.length, page, pageSize: 25, rosterBasis: "Current active eligible HQ staff" };
}
