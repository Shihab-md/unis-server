import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { google } from "googleapis";
import travelRoutes from "../routes/travelClaimRoutes.js";
import attendanceRoutes from "../routes/attendance.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Supervisor from "../models/Supervisor.js";
import TravelClaim from "../models/TravelClaim.js";
import PayrollRun from "../models/PayrollRun.js";
import RolePermission from "../models/RolePermission.js";
import School from "../models/School.js";
import StaffLeave from "../models/StaffLeave.js";
import { isPermissionAllowedForRole } from "../config/permissionCatalog.js";
import StaffAttendance from "../models/StaffAttendance.js";
import IntegrationCredential from "../models/IntegrationCredential.js";
import AuditLog from "../models/AuditLog.js";
import { encryptText } from "../utils/cryptoHelper.js";
import { PERMISSIONS, PERMISSION_CATALOG_VERSION, PERMISSION_KEYS, getInitialRolePermissionsForBootstrap } from "../config/permissionCatalog.js";
import { getRolePermissions } from "../services/permissionService.js";
import { initializeTaWorkflow, withHqFinanceTransaction } from "../services/hqFinanceTransactionService.js";
import { moneyPaise, claimInput, evidenceType } from "../utils/travelClaimPolicy.js";
import { taEvidenceName } from "../services/travelClaimEvidenceService.js";

// This suite performs real transactions only against an explicitly named test DB.
const uri = process.env.TA_TEST_MONGODB_URL;
if (!uri || !/^unis_ta_test_[a-z0-9_]+$/.test(new URL(uri).pathname.slice(1))) throw new Error("Set TA_TEST_MONGODB_URL to an isolated unis_ta_test_* replica-set database. Production names are refused.");
const actors = {}; let server, base, fakeDrive; const actualDrive = google.drive;
class FakeDrive {
  records = new Map(); bytes = new Map(); sequence = 0;
  constructor() {
    this.records.set("root",{id:"root",name:"UNIS",mimeType:"application/vnd.google-apps.folder",trashed:false});
    this.permissions = { list: async ({ fileId }) => ({ data: { permissions: this.records.get(fileId)?.permissions || [{ type: "user", role: "owner" }] } }) };
    this.files = {
      generateIds: async () => ({ data: { ids: [`evidence-${++this.sequence}`] } }),
      list: async ({ q }) => {
        const name = q.match(/name\s*=\s*'([^']+)'/)?.[1]; const parent = q.match(/'([^']+)' in parents/)?.[1];
        return { data: { files: [...this.records.values()].filter((f) => !f.trashed && (!name || f.name === name) && (!parent || f.parents?.includes(parent)) && f.mimeType === "application/vnd.google-apps.folder") } };
      },
      create: async ({ requestBody, media }) => {
        const record = { id: `folder-${++this.sequence}`, trashed: false, ...requestBody };
        if(this.records.has(record.id)) throw Object.assign(new Error("Duplicate Drive ID"),{code:409});
        if (media) { const chunks = []; for await (const c of media.body) chunks.push(c); this.bytes.set(record.id, Buffer.concat(chunks)); record.size = String(this.bytes.get(record.id).length); }
        this.records.set(record.id, record); return { data: { ...record } };
      },
      get: async ({ fileId, alt }) => {
        if (!this.records.has(fileId)) throw Object.assign(new Error("Fake Drive file not found"), {code:404});
        return alt === "media" ? { data: Readable.from([this.bytes.get(fileId)]) } : { data: { ...this.records.get(fileId) } };
      },
    };
  }
}
const jsonHeaders = (actor) => ({ Authorization: `Bearer ${actor.token}`, "Content-Type": "application/json" });
async function request(actor, method, path, body, expected = 200) {
  const response = await fetch(base + path, { method, headers: actor ? jsonHeaders(actor) : { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`); return data;
}
const input = () => ({ requestKey: randomUUID(), fromDateKey: "2026-10-01", toDateKey: "2026-10-02", fromPlace: "மதுரை", toPlace: "مدرسة", purpose: "School visit / பள்ளி ஆய்வு", transport: "Bus", expenses: [{ description: "Ticket / பயணச்சீட்டு", amount: "1200.25" }] });
async function create(actor = actors.supervisor, changes = {}) { return (await request(actor, "POST", "/api/travel-claims/", { ...input(), ...changes })).claim; }
const receipt = Buffer.from("%PDF-1.7\nlocal test evidence\n%%EOF");
async function upload(actor, claim, bytes = receipt, type = "application/pdf", expected = 200, key = randomUUID()) {
  const body = new FormData(); body.append("file", new Blob([bytes], { type }), "சான்று.pdf"); body.append("uploadKey", key); body.append("revision", String(claim.revision));
  const response = await fetch(`${base}/api/travel-claims/${claim._id}/evidence`, { method: "POST", headers: { Authorization: `Bearer ${actor.token}` }, body });
  const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
}
async function submitted(actor = actors.supervisor, changes = {}) { let claim = await create(actor, changes); claim = (await upload(actor, claim)).claim; return (await request(actor, "POST", `/api/travel-claims/${claim._id}/status`, { action: "Submit", revision: claim.revision })).claim; }
async function approve(claim, actor = actors.accountant, month = "2026-10", expected = 200) {
  return request(actor, "POST", `/api/travel-claims/${claim._id}/decision`, { decision: "Approved", approvedAmount: (claim.requestedAmountPaise / 100).toFixed(2), settlementMonth: month, revision: claim.revision }, expected);
}
async function generate(month = "2026-10") { const current = await request(actors.accountant,"GET",`/api/attendance/payroll?month=${month}&scopeType=HQ`); return (await request(actors.accountant, "POST", "/api/attendance/payroll/generate", { month, scopeType: "HQ", workingDays: 20, expectedRevision: current.run?.revision || 0 })).run; }
async function statusRun(run, status, expected = 200) { return request(actors.accountant, "PATCH", `/api/attendance/payroll/${run._id}/status`, { status, expectedRevision: run.revision || 0, paymentMethod: "Bank Transfer", paymentReference: "LOCAL-TEST" }, expected); }
before(async () => {
  process.env.JWT_SECRET = "isolated-test-secret-never-for-production"; process.env.INTEGRATION_ENC_SECRET = "isolated-test-encryption-secret"; process.env.APP_ENV = "development";
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  for (const [role, salary, fixed] of [["superadmin",0,0],["supervisor",10000,2500],["hqadmin",18000,1500],["accountant",15000,1000],["hquser",20000,3000],["hqstaff",8000,500],["teacher",5000,0],["guest",0,0]]) {
    const user = await User.create({ name: `${role} தமிழ் العربية`, email: `${role}@local.test`, role: role === "guest" ? "student" : role, password: "not-a-real-login-password" });
    if (role === "guest") { await User.collection.updateOne({ _id: user._id }, { $set: { role: "guest" } }); user.role = "guest"; }
    let staff;
    if (role === "supervisor") staff = await Supervisor.create({ userId: user._id, supervisorId: "TEST-SUP", address: "Local", contactNumber: 123456, salary, travellingAllowance: fixed, active: "Active" });
    else if (!["superadmin", "guest"].includes(role)) staff = await Employee.create({ userId: user._id, employeeId: `TEST-${role}`, organizationType: role === "teacher" ? "NISWAN" : "HQ", schoolId: role === "teacher" ? new mongoose.Types.ObjectId() : null, address: "Local", contactNumber: 123456, salary, travellingAllowance: fixed, active: "Active" });
    actors[role] = { user, staff, token: jwt.sign({ _id: String(user._id), role }, process.env.JWT_SECRET) };
  }
  for(const [key,role,code] of [["nadmin","admin","A"],["nstaff","staff","A"],["notheradmin","admin","B"]]) {
    const user=await User.create({name:`${key} தமிழ்`,email:`${key}@local.test`,role,password:"not-a-real-login-password"});
    const staff=await Employee.create({userId:user._id,employeeId:`TEST-${key}`,organizationType:"NISWAN",schoolId:new mongoose.Types.ObjectId(),address:"Local",contactNumber:123456,salary:0,active:"Active"});
    actors[key]={user,staff,schoolCode:code,token:jwt.sign({_id:String(user._id),role},process.env.JWT_SECRET)};
  }
  for(const code of ["A","B"]){
    const school=await School.create({code:`TEST-N-${code}`,nameEnglish:`Test Niswan ${code}`,address:"Local",districtStateId:new mongoose.Types.ObjectId(),supervisorId:actors.supervisor.staff._id,incharge1:"Local",incharge1Number:123456});
    for(const key of code==="A"?["nadmin","nstaff","teacher"]:["notheradmin"]){await Employee.updateOne({_id:actors[key].staff._id},{$set:{schoolId:school._id}});actors[key].schoolId=school._id;}
  }
  for (const model of Object.values(mongoose.models)) await model.init();
  for (const model of [User, Employee, Supervisor, PayrollRun, RolePermission, StaffAttendance, AuditLog]) await model.createIndexes();
  await initializeTaWorkflow();
  await IntegrationCredential.create({ key: "google_drive", refreshTokenEnc: encryptText("local-test-only"), folderId: "not-used" });
  fakeDrive = new FakeDrive(); google.drive = () => fakeDrive;
  const app = express(); app.use(express.json()); app.use("/api/travel-claims", travelRoutes); app.use("/api/attendance", attendanceRoutes);
  server = await new Promise((ready) => { const s = app.listen(0, "127.0.0.1", () => ready(s)); }); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { google.drive = actualDrive; if (server) await new Promise((done) => server.close(done)); if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } });

test("catalog 12 adds only four role-scoped TA keys", () => { assert.equal(PERMISSION_CATALOG_VERSION,12); assert.equal(PERMISSION_KEYS.length,108); assert(getInitialRolePermissionsForBootstrap("supervisor").includes(PERMISSIONS.TA_SELF_MANAGE)); assert(!getInitialRolePermissionsForBootstrap("teacher").includes(PERMISSIONS.TA_SELF_VIEW)); });
test("versioned permission migration preserves revoked existing permissions", async () => {
  await RolePermission.deleteOne({role:"hqstaff"}); await RolePermission.create({role:"hqstaff",permissions:[],catalogVersion:11,revision:1});
  const permissions=await getRolePermissions("hqstaff"); assert.deepEqual(new Set(permissions),new Set([PERMISSIONS.TA_SELF_VIEW,PERMISSIONS.TA_SELF_MANAGE]));
});
test("missing JWT and non-HQ roles cannot access claims", async () => { await request(null,"GET","/api/travel-claims/mine",undefined,401); for(const role of ["teacher","guest"]) await request(actors[role],"GET","/api/travel-claims/mine",undefined,403); });
test("all five claimant roles have self-service but only finance roles review", async () => {
  for(const role of ["supervisor","hqadmin","hquser","hqstaff","accountant"]){const meta=await request(actors[role],"GET","/api/travel-claims/meta"); assert.equal(meta.canManageOwn,true,role); assert.equal(meta.canReview,["hqadmin","accountant"].includes(role));}
  assert.equal((await request(actors.superadmin,"GET","/api/travel-claims/meta")).canManageOwn,false);
});
test("claim creation ignores supplied identity, status, amount and payroll ownership", async () => {
  const claim=await create(actors.supervisor,{userId:String(actors.accountant.user._id),approvedAmountPaise:999999,status:"Paid",payrollRunId:new mongoose.Types.ObjectId()});
  assert.equal(claim.userId,String(actors.supervisor.user._id)); assert.equal(claim.status,"Draft"); assert.equal(claim.approvedAmountPaise,0); assert.equal(claim.requestedAmountPaise,120025);
  assert.equal(claim.fromPlace,"மதுரை"); assert.equal(claim.toPlace,"مدرسة");
});
test("idempotent concurrent create requests result in one claim", async () => { const body=input();const data=await Promise.all([request(actors.hquser,"POST","/api/travel-claims/",body),request(actors.hquser,"POST","/api/travel-claims/",body)]);assert.equal(data[0].claim._id,data[1].claim._id);assert.equal(await TravelClaim.countDocuments({requestKey:body.requestKey}),1); });
test("submitted claims require evidence", async () => { const claim=await create();const data=await request(actors.supervisor,"POST",`/api/travel-claims/${claim._id}/status`,{action:"Submit",revision:claim.revision},400);assert.equal(data.code,"TA_EVIDENCE_REQUIRED"); });
test("evidence uploads validate content and preserve non-English filenames", async () => {
  let claim=await create();await upload(actors.supervisor,claim,Buffer.from("<script>bad</script>"),"application/pdf",400);claim=(await upload(actors.supervisor,claim)).claim;
  assert.equal(claim.evidence.length,1); assert.equal(claim.evidence[0].name,"சான்று.pdf"); assert.equal(claim.evidence[0].driveFileId,undefined);
  const res=await fetch(`${base}/api/travel-claims/${claim._id}/evidence/${claim.evidence[0]._id}`,{headers:{Authorization:`Bearer ${actors.supervisor.token}`}});assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),receipt);
});
test("another claimant cannot read or edit a claim or its evidence", async () => {
  let claim=await create();claim=(await upload(actors.supervisor,claim)).claim;
  await request(actors.hquser,"GET",`/api/travel-claims/${claim._id}`,undefined,403);
  await request(actors.hquser,"PATCH",`/api/travel-claims/${claim._id}`,{...input(),revision:claim.revision},403);
  const res=await fetch(`${base}/api/travel-claims/${claim._id}/evidence/${claim.evidence[0]._id}`,{headers:{Authorization:`Bearer ${actors.hquser.token}`}});assert.equal(res.status,403);
});
test("evidence is immutable after submission", async () => { const claim=await submitted();const data=await request(actors.supervisor,"DELETE",`/api/travel-claims/${claim._id}/evidence/${claim.evidence[0]._id}`,{revision:claim.revision},409);assert.equal(data.code,"TA_LOCKED"); });
test("finance role cannot decide its own claim", async () => { const claim=await submitted(actors.accountant);const result=await approve(claim,actors.accountant,"2026-10",403);assert.equal(result.code,"TA_SELF_APPROVAL");await approve(claim,actors.hqadmin); });
test("claimant roles cannot access approval queues or decision endpoint", async () => { const claim=await submitted();for(const role of ["supervisor","hquser","hqstaff"]) {await request(actors[role],"GET","/api/travel-claims/review",undefined,403);await approve(claim,actors[role],"2026-10",403);} });
test("partial approval requires a reason and cannot exceed the request", async () => {
  const claim=await submitted();const url=`/api/travel-claims/${claim._id}/decision`;
  await request(actors.accountant,"POST",url,{decision:"Approved",approvedAmount:"1201",settlementMonth:"2026-10",revision:claim.revision},400);
  await request(actors.accountant,"POST",url,{decision:"Approved",approvedAmount:"1000",settlementMonth:"2026-10",revision:claim.revision},400);
  const approved=(await request(actors.accountant,"POST",url,{decision:"Approved",approvedAmount:"1000",settlementMonth:"2026-10",reason:"Only eligible tickets",revision:claim.revision})).claim;assert.equal(approved.approvedAmountPaise,100000);
});
test("return/edit/resubmit preserves decision history and increments revision", async () => {
  let claim=await submitted(actors.hquser);claim=(await request(actors.hqadmin,"POST",`/api/travel-claims/${claim._id}/decision`,{decision:"Returned",reason:"Add journey details",revision:claim.revision})).claim;
  claim=(await request(actors.hquser,"PATCH",`/api/travel-claims/${claim._id}`,{...input(),purpose:"திருத்தப்பட்ட பயண விவரம்",revision:claim.revision})).claim;
  assert.equal(claim.status,"Draft");assert(claim.history.some(e=>e.action==="Returned"));assert.equal(claim.purpose,"திருத்தப்பட்ட பயண விவரம்");
  claim=(await request(actors.hquser,"POST",`/api/travel-claims/${claim._id}/status`,{action:"Submit",revision:claim.revision})).claim;assert.equal(claim.status,"Submitted");
});
test("stale concurrent decisions allow only one winner", async () => {
  const claim=await submitted();const body={decision:"Approved",approvedAmount:"1200.25",settlementMonth:"2026-10",revision:claim.revision};
  const responses=await Promise.all([actors.accountant,actors.hqadmin].map(actor=>fetch(`${base}/api/travel-claims/${claim._id}/decision`,{method:"POST",headers:jsonHeaders(actor),body:JSON.stringify(body)})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
});
test("a failed transaction rolls back claim changes", async () => {
  const claim=await create();await assert.rejects(withHqFinanceTransaction(async session=>{await TravelClaim.updateOne({_id:claim._id},{$set:{status:"Paid"}},{session});throw new Error("injected failure");}));assert.equal((await TravelClaim.findById(claim._id)).status,"Draft");
});
test("money and date validation reject malformed values without rounding claims", () => {
  assert.equal(moneyPaise("1200.25"),120025); for(const value of ["NaN","Infinity","-1","0","1e3","10.001",null])assert.throws(()=>moneyPaise(value));
  assert.throws(()=>claimInput({...input(),fromDateKey:"2026-02-30"}));assert.throws(()=>claimInput({...input(),toDateKey:"2026-09-30"}));assert.throws(()=>evidenceType(Buffer.alloc(3*1024*1024+1)));
});
test("inactive HQ identities cannot submit TA requests", async () => { await Employee.updateOne({_id:actors.hqstaff.staff._id},{$set:{active:"In-Active"}});await request(actors.hqstaff,"POST","/api/travel-claims/",input(),403);await Employee.updateOne({_id:actors.hqstaff.staff._id},{$set:{active:"Active"}}); });
test("payroll excludes fixed TA, adds approved claims after salary-only attendance deductions", async () => {
  await StaffAttendance.create({staffType:"Supervisor",staffId:actors.supervisor.staff._id,userId:actors.supervisor.user._id,organizationType:"HQ",dateKey:"2026-10-03",status:"Absent",markedBy:actors.hqadmin.user._id});
  const run=await generate();const item=run.items.find(i=>i.staffType==="Supervisor");assert.equal(run.taPolicyVersion,1);assert.equal(item.travellingAllowance,0);assert.equal(item.grossSalary,10000);assert.equal(item.attendanceDeduction,500);assert(item.approvedTaClaims>0);assert.equal(item.netSalary,9500+item.approvedTaClaims);
  for(const snapshot of item.travelClaimItems)assert.equal((await TravelClaim.findById(snapshot.claimId)).status,"PayrollReserved");
});
test("recalculation preserves manual adjustments and never doubles TA", async () => {
  let run=await generate();let item=run.items.find(i=>i.staffType==="Supervisor");const ta=item.approvedTaClaims;
  run=(await request(actors.accountant,"PATCH",`/api/attendance/payroll/${run._id}/items/${item._id}`,{expectedRevision:run.revision||0,manualAllowance:100,manualDeduction:50,remarks:"Preserve adjustment"})).run;
  run=await generate();item=run.items.find(i=>i.staffType==="Supervisor");assert.equal(item.approvedTaClaims,ta);assert.equal(item.manualAllowance,100);assert.equal(item.manualDeduction,50);assert.equal(item.remarks,"Preserve adjustment");assert.equal(item.netSalary,9550+ta);
});
test("a claim is reserved by at most one of two concurrent payroll months", async () => {
  const claim=(await approve(await submitted(actors.hquser))).claim;
  const [oct,nov]=await Promise.all([generate("2026-10"),generate("2026-11")]);
  const included=[oct,nov].flatMap(r=>r.items.flatMap(i=>i.travelClaimItems)).filter(c=>String(c.claimId)===claim._id);assert.equal(included.length,1);
});
test("newly approved eligible claims force payroll recalculation and fresh review", async () => {
  let run=await generate();run=(await statusRun(run,"Reviewed")).run;await approve(await submitted(actors.hquser));
  const blocked=await statusRun(run,"Finalized",409);assert.equal(blocked.code,"TA_RECALCULATE_REQUIRED");run=await generate();assert.equal(run.status,"Draft");
});
test("finalized payroll is immutable and payment settles linked claims once", async () => {
  let run=await generate();run=(await statusRun(run,"Reviewed")).run;run=(await statusRun(run,"Finalized")).run;
  await request(actors.accountant,"POST","/api/attendance/payroll/generate",{month:"2026-10",scopeType:"HQ",workingDays:20},409);
  const paid=(await statusRun(run,"Paid")).run;const repeated=(await statusRun(paid,"Paid")).run;assert.equal(repeated.paidAt,paid.paidAt);
  for(const item of paid.items)for(const snapshot of item.travelClaimItems){const claim=await TravelClaim.findById(snapshot.claimId);assert.equal(claim.status,"Paid");assert.equal(claim.history.filter(e=>e.action==="Paid").length,1);}
});
test("a closed settlement month is rejected; a later month is accepted", async () => {const claim=await submitted();const blocked=await approve(claim,actors.accountant,"2026-10",409);assert.equal(blocked.code,"TA_MONTH_LOCKED");await approve(claim,actors.accountant,"2026-12");});
test("historical finalized fixed-TA payslips retain their amounts", async () => {
  const staff=actors.supervisor;const legacy=await PayrollRun.create({monthKey:"2026-09",organizationType:"HQ",schoolId:null,workingDays:20,status:"Finalized",generatedBy:actors.accountant.user._id,items:[{staffType:"Supervisor",staffId:staff.staff._id,userId:staff.user._id,name:"Historical",monthlySalary:10000,travellingAllowance:2500,grossSalary:12500,netSalary:12500,workingDays:20}]});
  const slips=await request(staff,"GET","/api/attendance/payroll/mine");const slip=slips.payslips.find(s=>s.monthKey==="2026-09");assert.equal(slip.taPolicyVersion,0);assert.equal(slip.item.travellingAllowance,2500);assert.equal(slip.item.netSalary,12500);
  await statusRun(legacy,"Paid");assert.equal((await PayrollRun.findById(legacy._id)).items[0].travellingAllowance,2500);
});
test("new payslips expose approved claim references only to the matching staff identity", async () => {
  const slips=(await request(actors.supervisor,"GET","/api/attendance/payroll/mine")).payslips;const slip=slips.find(s=>s.monthKey==="2026-10");assert.equal(slip.taPolicyVersion,1);assert(slip.item.travelClaimItems.length>0);assert(slip.item.approvedTaClaims>0);
  const other=(await request(actors.hquser,"GET","/api/attendance/payroll/mine")).payslips;assert(other.every(s=>s.item.staffId===String(actors.hquser.staff._id)));
});
test("API audit trail records workflow decisions without evidence bytes or tokens", async () => { const log=await AuditLog.findOne({action:"TA_DECISION",success:true}).lean();assert(log);const serialized=JSON.stringify(log);assert(!serialized.includes(actors.accountant.token));assert(!serialized.includes("local test evidence")); });
test("UTF-8 filename handling covers all supported scripts without double-decoding", () => {
  for(const name of ["receipt.pdf","சான்று.pdf","رسید.pdf","إيصال.pdf","രസീത്.pdf","ರಸೀದಿ.pdf","రసీదు.pdf","café.pdf","ticket-😀.pdf"]){
    assert.equal(taEvidenceName(name,name,"pdf"),name);
    assert.equal(taEvidenceName(Buffer.from(name,"utf8").toString("latin1"),undefined,"pdf"),name);
  }
  assert.equal(taEvidenceName("café.pdf",undefined,"pdf"),"café.pdf");
  assert.throws(()=>taEvidenceName("x", "bad\ud800.pdf", "pdf"));
});
test("concurrent cancellation and approval have one committed outcome", async () => {
  const claim=await submitted(actors.hquser);
  const results=await Promise.all([
    fetch(`${base}/api/travel-claims/${claim._id}/status`,{method:"POST",headers:jsonHeaders(actors.hquser),body:JSON.stringify({action:"Cancel",revision:claim.revision})}),
    fetch(`${base}/api/travel-claims/${claim._id}/decision`,{method:"POST",headers:jsonHeaders(actors.accountant),body:JSON.stringify({decision:"Approved",approvedAmount:"1200.25",settlementMonth:"2027-01",revision:claim.revision})}),
  ]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert(["Cancelled","Approved"].includes((await TravelClaim.findById(claim._id)).status));
});
test("oversized evidence is rejected before storage", async () => {const claim=await create();const result=await upload(actors.supervisor,claim,Buffer.alloc(3*1024*1024+1),"application/pdf",400);assert.equal(result.code,"TA_INVALID_FILE");assert.equal((await TravelClaim.findById(claim._id)).evidence.length,0);});
test("removed evidence cannot be downloaded or used to submit", async () => {
  let claim=await create();claim=(await upload(actors.supervisor,claim)).claim;const id=claim.evidence[0]._id;
  claim=(await request(actors.supervisor,"DELETE",`/api/travel-claims/${claim._id}/evidence/${id}`,{revision:claim.revision})).claim;
  await request(actors.supervisor,"POST",`/api/travel-claims/${claim._id}/status`,{action:"Submit",revision:claim.revision},400);
  const response=await fetch(`${base}/api/travel-claims/${claim._id}/evidence/${id}`,{headers:{Authorization:`Bearer ${actors.supervisor.token}`}});assert.equal(response.status,404);
});
test("tampered stored evidence is detected on download", async () => {
  let claim=await create();claim=(await upload(actors.supervisor,claim)).claim;const stored=await TravelClaim.findById(claim._id);const id=stored.evidence[0].driveFileId;
  const original=fakeDrive.bytes.get(id);fakeDrive.bytes.set(id,Buffer.alloc(original.length,65));
  const response=await fetch(`${base}/api/travel-claims/${claim._id}/evidence/${claim.evidence[0]._id}`,{headers:{Authorization:`Bearer ${actors.supervisor.token}`}});assert.equal(response.status,409);
  fakeDrive.bytes.set(id,original);
});
test("legacy Reviewed payroll requires regeneration and preserves manual adjustments", async () => {
  const actor=actors.hquser;
  const legacy=await PayrollRun.create({monthKey:"2026-08",organizationType:"HQ",schoolId:null,workingDays:20,status:"Reviewed",generatedBy:actors.accountant.user._id,items:[{staffType:"Employee",staffId:actor.staff._id,userId:actor.user._id,name:"Old draft",monthlySalary:20000,travellingAllowance:3000,grossSalary:23000,netSalary:23100,manualAllowance:100,workingDays:20}]});
  const blocked=await statusRun(legacy,"Finalized",409);assert.equal(blocked.code,"TA_RECALCULATE_REQUIRED");
  const run=await generate("2026-08");const item=run.items.find(i=>i.staffId===String(actor.staff._id));assert.equal(run.status,"Draft");assert.equal(item.grossSalary,20000);assert.equal(item.travellingAllowance,0);assert.equal(item.manualAllowance,100);assert.equal(item.netSalary,20100);
});
test("approved claims for an inactive staff record are explicitly excluded and remain unpaid", async () => {
  const claim=(await approve(await submitted(actors.hqstaff),actors.accountant,"2027-02")).claim;
  await Employee.updateOne({_id:actors.hqstaff.staff._id},{$set:{active:"In-Active"}});
  const run=await generate("2027-02");assert(run.taExcludedClaims.some(c=>String(c.claimId)===claim._id));const saved=await TravelClaim.findById(claim._id);assert.equal(saved.status,"Approved");assert.equal(saved.payrollRunId,null);
  await Employee.updateOne({_id:actors.hqstaff.staff._id},{$set:{active:"Active"}});
});
test("stale payroll adjustments cannot overwrite a more recent adjustment", async () => {
  const run=await generate("2027-03");const item=run.items.find(i=>i.staffType==="Supervisor");const path=`/api/attendance/payroll/${run._id}/items/${item._id}`;
  await request(actors.accountant,"PATCH",path,{expectedRevision:run.revision,manualAllowance:200,manualDeduction:0});
  const blocked=await request(actors.hqadmin,"PATCH",path,{expectedRevision:run.revision,manualAllowance:999,manualDeduction:0},409);assert.equal(blocked.code,"TA_PAYROLL_CHANGED");
  assert.equal((await PayrollRun.findById(run._id)).items.find(i=>i.staffType==="Supervisor").manualAllowance,200);
});
test("older clients missing a payroll revision cannot mutate a payroll", async () => {
  const response=await request(actors.accountant,"POST","/api/attendance/payroll/generate",{month:"2027-04",scopeType:"HQ",workingDays:20},409);assert.equal(response.code,"TA_PAYROLL_CHANGED");assert.equal(await PayrollRun.countDocuments({monthKey:"2027-04"}),0);
});
test("approval racing payroll finalization cannot produce an omitted approved claim", async () => {
  const claim=await submitted();let run=await generate("2027-05");run=(await statusRun(run,"Reviewed")).run;
  const responses=await Promise.all([
    fetch(`${base}/api/travel-claims/${claim._id}/decision`,{method:"POST",headers:jsonHeaders(actors.accountant),body:JSON.stringify({decision:"Approved",approvedAmount:"1200.25",settlementMonth:"2027-05",revision:claim.revision})}),
    fetch(`${base}/api/attendance/payroll/${run._id}/status`,{method:"PATCH",headers:jsonHeaders(actors.hqadmin),body:JSON.stringify({status:"Finalized",expectedRevision:run.revision})}),
  ]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const savedClaim=await TravelClaim.findById(claim._id);const savedRun=await PayrollRun.findById(run._id);
  if(savedClaim.status==="Approved")assert.equal(savedRun.status,"Reviewed");else{assert.equal(savedClaim.status,"Submitted");assert.equal(savedRun.status,"Finalized");}
});
test("mid-payment failure rolls back all claim payments and the payroll status", async () => {
  await approve(await submitted(actors.supervisor),actors.accountant,"2027-06");await approve(await submitted(actors.hquser),actors.accountant,"2027-06");
  let run=await generate("2027-06");run=(await statusRun(run,"Reviewed")).run;run=(await statusRun(run,"Finalized")).run;
  const original=TravelClaim.prototype.save;let count=0;
  TravelClaim.prototype.save=function(...args){if(this.status==="Paid"&&++count===2)throw new Error("Injected mid-payment failure");return original.apply(this,args);};
  try{await statusRun(run,"Paid",500);}finally{TravelClaim.prototype.save=original;}
  assert.equal((await PayrollRun.findById(run._id)).status,"Finalized");const claims=await TravelClaim.find({payrollRunId:run._id});assert(claims.length>=2);assert(claims.every(c=>c.status==="PayrollReserved"));await statusRun(run,"Paid");
});

test("concurrent first evidence uploads share one logical Drive folder", async () => {
  const previous = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const rootId = `isolated-root-${randomUUID()}`;
  fakeDrive.records.set(rootId, { id: rootId, name: "UNIS", mimeType: "application/vnd.google-apps.folder", trashed: false });
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = rootId;
  try {
    const first = await create(actors.supervisor); const second = await create(actors.hquser);
    const uploaded = await Promise.all([upload(actors.supervisor, first), upload(actors.hquser, second)]);
    const folders = [...fakeDrive.records.values()].filter(f => f.parents?.includes(rootId) && f.name === "TravelClaims");
    assert.equal(folders.length, 1);
    assert.equal([...fakeDrive.records.values()].filter(f => f.parents?.includes(folders[0].id)).length, 2);
    const count = fakeDrive.records.size;
    const claim = uploaded[0].claim;
    const response = await fetch(`${base}/api/travel-claims/${claim._id}/evidence/${claim.evidence[0]._id}`, { headers: { Authorization: `Bearer ${actors.supervisor.token}` } });
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), receipt); assert.equal(fakeDrive.records.size, count);
  } finally { fakeDrive.records.delete(rootId); if (previous === undefined) delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID; else process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = previous; }
});
test("decision reasons reject malformed Unicode before persistence", async () => {
  const claim = await submitted();
  const result = await request(actors.accountant, "POST", `/api/travel-claims/${claim._id}/decision`, { decision: "Returned", revision: claim.revision, reason: "invalid\ud800" }, 400);
  assert.equal(result.code, "TA_INVALID_FIELDS"); assert.equal((await TravelClaim.findById(claim._id)).status, "Submitted");
});

test("public or whole-domain Drive roots refuse receipt uploads", async () => {
  const claim = await create(); const root = fakeDrive.records.get("root"); const original = root.permissions;
  try { for (const type of ["anyone", "domain"]) { root.permissions = [{ type, role: "reader" }]; const result = await upload(actors.supervisor, claim, receipt, "application/pdf", 409); assert.equal(result.code, "TA_EVIDENCE_UNAVAILABLE"); } }
  finally { root.permissions = original; }
  assert.equal((await TravelClaim.findById(claim._id)).evidence.length, 0);
});
test("evidence downloads refuse a receipt shared publicly outside the app", async () => {
  let claim = await create(); claim = (await upload(actors.supervisor, claim)).claim;
  const stored = await TravelClaim.findById(claim._id); const file = fakeDrive.records.get(stored.evidence[0].driveFileId);
  file.permissions = [{ type: "anyone", role: "reader" }];
  try { const response = await fetch(`${base}/api/travel-claims/${claim._id}/evidence/${claim.evidence[0]._id}`, { headers: { Authorization: `Bearer ${actors.supervisor.token}` } }); assert.equal(response.status, 409); assert.equal((await response.json()).code, "TA_EVIDENCE_UNAVAILABLE"); }
  finally { delete file.permissions; }
});

// Leave and navigation release regression cases use a separate past period.
const periodMonth = "2026-03", periodDate = "2026-03-05";
const leaveInput = (changes = {}) => ({ leaveType: "Sick Leave", dayType: "Full Day", fromDateKey: periodDate, toDateKey: periodDate, reason: "உடல்நலம் / إجازة", ...changes });
async function resetPeriod() {
  // Restore the fixture defaults after the earlier explicit-revocation test.
  await RolePermission.updateOne({role:"hqstaff"},{$set:{permissions:getInitialRolePermissionsForBootstrap("hqstaff"),catalogVersion:12}});
  await PayrollRun.deleteMany({ monthKey: { $in: ["2026-03", "2026-04"] } });
  await StaffLeave.deleteMany({ fromDateKey: { $gte: "2026-03-01", $lte: "2026-04-30" } });
  await StaffAttendance.deleteMany({ dateKey: { $gte: "2026-03-01", $lte: "2026-04-30" } });
}
const workflowTest = (name, fn) => test(name, async () => { await resetPeriod(); await fn(); });
async function applyLeave(actor = actors.hquser, changes = {}, expected = 201) { return request(actor, "POST", "/api/attendance/staff-leaves/mine", leaveInput(changes), expected); }
async function leaveDecision(leave, status = "Approved", isPaid = false, actor = actors.hqadmin, expected = 200) {
  return request(actor, "PATCH", `/api/attendance/staff-leaves/${leave._id}/status`, { status, isPaid, revision: leave.revision || 0 }, expected);
}
async function markAttendance(target = actors.hquser, status = "Absent", expected = 200) {
  return request(actors.hqadmin, "POST", "/api/attendance/staff/bulk", { scopeType: "HQ", date: periodDate, staffCategory: target.user.role === "supervisor" ? "MUAVIN" : "HQ_STAFF", rows: [{ staffType: target.user.role === "supervisor" ? "Supervisor" : "Employee", staffId: String(target.staff._id), status }] }, expected);
}
workflowTest("Niswan Staff student-entry access remains blocked at catalog and API", async () => {
  assert.equal(isPermissionAllowedForRole(PERMISSIONS.STUDENT_ATTENDANCE_ENTER, "staff"), false);
  await request(actors.nstaff, "POST", "/api/attendance/student/bulk", { date: periodDate, rows: [] }, 403);
});
workflowTest("Niswan Admin sees own teachers/staff and Teacher remains student-only", async () => {
  const data = await request(actors.nadmin, "GET", `/api/attendance/staff/roster?scopeType=NISWAN&schoolId=${actors.notheradmin.schoolId}&date=${periodDate}`);
  assert.equal(String(data.scope.schoolId),String(actors.nadmin.schoolId));assert(data.staff.some(s=>s.role==="teacher"));assert(data.staff.some(s=>s.role==="staff"));
  await request(actors.teacher,"POST","/api/attendance/staff/bulk",{scopeType:"NISWAN",date:periodDate,rows:[]},403);
  const students = await request(actors.teacher,"GET",`/api/attendance/student/roster?schoolId=${actors.notheradmin.schoolId}&academicYearId=${new mongoose.Types.ObjectId()}&courseId=${new mongoose.Types.ObjectId()}&date=${periodDate}`);
  assert.equal(String(students.school._id),String(actors.teacher.schoolId));
});
workflowTest("HQ leave application preserves Unicode and starts Pending with a revision",async()=>{
  const {leave}=await applyLeave();assert.equal(leave.status,"Pending");assert.equal(leave.revision,1);assert.equal(leave.reason,"உடல்நலம் / إجازة");assert.equal(leave.history.length,1);
});
workflowTest("HQ Admin can approve HQ User, HQ Staff, Accountant and Muavin leave",async()=>{
  for(const role of ["hquser","hqstaff","accountant","supervisor"]){const {leave}=await applyLeave(actors[role]);const out=await leaveDecision(leave);assert.equal(out.leave.status,"Approved");assert.equal(out.leave.revision,2);}
});
workflowTest("leave self-approval is blocked and HQ Admin leave goes to SuperAdmin",async()=>{
  const {leave}=await applyLeave(actors.hqadmin);await leaveDecision(leave,"Approved",true,actors.hqadmin,403);const out=await leaveDecision(leave,"Approved",true,actors.superadmin);assert.equal(out.leave.status,"Approved");
});
workflowTest("Accountant can approve TA but cannot approve leave",async()=>{
  const {leave}=await applyLeave();await leaveDecision(leave,"Approved",true,actors.accountant,403);
});
workflowTest("Niswan teacher leave is scoped to own Admin, and Admin leave escalates",async()=>{
  const {leave}=await applyLeave(actors.teacher);await leaveDecision(leave,"Approved",true,actors.notheradmin,403);await leaveDecision(leave,"Approved",true,actors.nadmin);
  const admin=(await applyLeave(actors.nadmin)).leave;await leaveDecision(admin,"Approved",true,actors.hqadmin,403);await leaveDecision(admin,"Approved",true,actors.superadmin);
});
workflowTest("Rejected and Cancelled leave cannot be reopened through direct API calls",async()=>{
  for(const end of ["Rejected","Cancelled"]){const {leave}=await applyLeave();const out=await leaveDecision(leave,end,false,end==="Cancelled"?actors.hquser:actors.hqadmin);const denied=await leaveDecision(out.leave,"Approved",true,actors.hqadmin,409);assert.equal(denied.code,"LEAVE_STATE_LOCKED");}
});
workflowTest("an approved leave cannot be re-decided or have its paid flag overwritten",async()=>{
  const first=(await leaveDecision((await applyLeave()).leave,"Approved",true)).leave;
  for(const status of ["Approved","Rejected"]){const data=await leaveDecision(first,status,false,actors.hqadmin,409);assert.equal(data.code,"LEAVE_STATE_LOCKED");}
  assert.equal((await StaffLeave.findById(first._id)).isPaid,true);
});
workflowTest("missing/stale leave revisions and non-boolean approval flags are rejected",async()=>{
  const {leave}=await applyLeave();for(const revision of [undefined,0]){const data=await request(actors.hqadmin,"PATCH",`/api/attendance/staff-leaves/${leave._id}/status`,{status:"Approved",isPaid:true,revision},409);assert.equal(data.code,"LEAVE_STALE");}
  const data=await request(actors.hqadmin,"PATCH",`/api/attendance/staff-leaves/${leave._id}/status`,{status:"Approved",isPaid:"false",revision:leave.revision},400);assert.equal(data.code,"LEAVE_INVALID_FIELDS");assert.equal((await StaffLeave.findById(leave._id)).status,"Pending");
});
workflowTest("concurrent leave decisions have one winner and one history event",async()=>{
  const {leave}=await applyLeave();const responses=await Promise.all(["Approved","Rejected"].map(status=>fetch(`${base}/api/attendance/staff-leaves/${leave._id}/status`,{method:"PATCH",headers:jsonHeaders(actors.hqadmin),body:JSON.stringify({status,isPaid:false,revision:leave.revision})})));assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const saved=await StaffLeave.findById(leave._id);assert.equal(saved.history.length,2);assert.equal(saved.revision,2);
});
workflowTest("concurrent overlapping leave applications create only one request",async()=>{
  const responses=await Promise.all([1,2].map(()=>fetch(`${base}/api/attendance/staff-leaves/mine`,{method:"POST",headers:jsonHeaders(actors.hquser),body:JSON.stringify(leaveInput())})));assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal(await StaffLeave.countDocuments({userId:actors.hquser.user._id,fromDateKey:periodDate}),1);
});
workflowTest("paid leave invalidates Reviewed payroll and removes an earlier absence deduction",async()=>{
  await markAttendance();let run=await generate(periodMonth);const item=run.items.find(i=>i.staffId===String(actors.hquser.staff._id));assert.equal(item.attendanceDeduction,1000);
  run=(await request(actors.accountant,"PATCH",`/api/attendance/payroll/${run._id}/items/${item._id}`,{manualAllowance:75,manualDeduction:10,expectedRevision:run.revision})).run;run=(await statusRun(run,"Reviewed")).run;
  const leave=(await applyLeave()).leave;await leaveDecision(leave,"Approved",true);const invalidated=await PayrollRun.findById(run._id);assert.equal(invalidated.status,"Draft");assert.equal(invalidated.needsRecalculation,true);assert.equal(invalidated.revision,run.revision+1);assert.equal(invalidated.reviewedBy,null);
  await statusRun(invalidated,"Reviewed",409);const denied=await request(actors.accountant,"PATCH",`/api/attendance/payroll/${run._id}/items/${item._id}`,{manualAllowance:0,manualDeduction:0,expectedRevision:invalidated.revision},409);assert.equal(denied.code,"TA_RECALCULATE_REQUIRED");
  const recalculated=await generate(periodMonth);const updated=recalculated.items.find(i=>i.staffId===String(actors.hquser.staff._id));assert.equal(recalculated.needsRecalculation,false);assert.equal(updated.attendanceDeduction,0);assert.equal(updated.manualAllowance,75);assert.equal(updated.manualDeduction,10);assert.equal(updated.netSalary,20065);
});
workflowTest("unpaid full/half-day leave is deducted once, without double-counting absence",async()=>{
  for(const [dayType,expected] of [["Full Day",1000],["Half Day",500]]){await resetPeriod();await markAttendance();await leaveDecision((await applyLeave(actors.hquser,{dayType})).leave);const run=await generate(periodMonth);const item=run.items.find(i=>i.staffId===String(actors.hquser.staff._id));assert.equal(item.attendanceDeduction,expected);assert.equal(item.absentUnits,0);assert.equal(item.halfDayUnits,0);}
});
workflowTest("attendance source changes invalidate Reviewed payroll but remarks-only edits do not",async()=>{
  await markAttendance();let run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;
  await markAttendance(actors.hquser,"Present");let saved=await PayrollRun.findById(run._id);assert.equal(saved.needsRecalculation,true);assert.equal(saved.status,"Draft");run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;
  await request(actors.hqadmin,"POST","/api/attendance/staff/bulk",{scopeType:"HQ",date:periodDate,rows:[{staffType:"Employee",staffId:String(actors.hquser.staff._id),status:"Present",remarks:"தமிழ்"}]});saved=await PayrollRun.findById(run._id);assert.equal(saved.status,"Reviewed");assert.equal(saved.revision,run.revision);
});
workflowTest("Finalized payroll blocks leave approval and attendance source changes",async()=>{
  const leave=(await applyLeave()).leave;await markAttendance();let run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;run=(await statusRun(run,"Finalized")).run;
  const result=await leaveDecision(leave,"Approved",false,actors.hqadmin,409);assert.equal(result.code,"LEAVE_PAYROLL_LOCKED");await markAttendance(actors.hquser,"Present",409);assert.equal((await StaffLeave.findById(leave._id)).status,"Pending");assert.equal((await PayrollRun.findById(run._id)).revision,run.revision);
});
workflowTest("Paid payroll blocks approved-leave cancellation and new backdated applications",async()=>{
  const approved=(await leaveDecision((await applyLeave()).leave,"Approved",true)).leave;await markAttendance(actors.hquser,"Leave");let run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;run=(await statusRun(run,"Finalized")).run;run=(await statusRun(run,"Paid")).run;
  const result=await leaveDecision(approved,"Cancelled",true,actors.hquser,409);assert.equal(result.code,"LEAVE_PAYROLL_LOCKED");await applyLeave(actors.hqstaff,{fromDateKey:"2026-03-06",toDateKey:"2026-03-06"},409);assert.equal((await StaffLeave.findById(approved._id)).status,"Approved");
});
workflowTest("pending leave can be cancelled after payroll freezes because it changes no salary",async()=>{
  const leave=(await applyLeave()).leave;let run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;await statusRun(run,"Finalized");const out=await leaveDecision(leave,"Cancelled",false,actors.hquser);assert.equal(out.leave.status,"Cancelled");
});
workflowTest("cross-month leave approval rolls back entirely when one payroll month is frozen",async()=>{
  const leave=(await applyLeave(actors.hquser,{fromDateKey:"2026-03-31",toDateKey:"2026-04-01"})).leave;let march=await generate(periodMonth);march=(await statusRun(march,"Reviewed")).run;await statusRun(march,"Finalized");const april=await generate("2026-04");await leaveDecision(leave,"Approved",false,actors.hqadmin,409);const saved=await PayrollRun.findById(april._id);assert.equal(saved.needsRecalculation,false);assert.equal(saved.revision,april.revision);
});
workflowTest("mid-approval failure rolls back leave status and payroll invalidation",async()=>{
  let run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;const leave=(await applyLeave()).leave;const original=StaffLeave.prototype.save;
  StaffLeave.prototype.save=function(...args){if(this.status==="Approved")throw new Error("Injected leave-save failure");return original.apply(this,args);};
  try{await leaveDecision(leave,"Approved",false,actors.hqadmin,500);}finally{StaffLeave.prototype.save=original;}
  const saved=await PayrollRun.findById(run._id);assert.equal(saved.status,"Reviewed");assert.equal(saved.needsRecalculation,false);assert.equal(saved.revision,run.revision);assert.equal((await StaffLeave.findById(leave._id)).status,"Pending");
});
workflowTest("payroll finalization and leave approval serialize with one valid winner",async()=>{
  const leave=(await applyLeave()).leave;let run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;
  const responses=await Promise.all([fetch(`${base}/api/attendance/staff-leaves/${leave._id}/status`,{method:"PATCH",headers:jsonHeaders(actors.hqadmin),body:JSON.stringify({status:"Approved",isPaid:false,revision:leave.revision})}),fetch(`${base}/api/attendance/payroll/${run._id}/status`,{method:"PATCH",headers:jsonHeaders(actors.accountant),body:JSON.stringify({status:"Finalized",expectedRevision:run.revision})})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const saved=await PayrollRun.findById(run._id),claim=await StaffLeave.findById(leave._id);if(claim.status==="Approved"){assert.equal(saved.status,"Draft");assert(saved.needsRecalculation);}else assert.equal(saved.status,"Finalized");
});
workflowTest("cancelled approved leave keeps attendance but requires explicit re-marking",async()=>{
  const approved=(await leaveDecision((await applyLeave()).leave,"Approved",true)).leave;await markAttendance(actors.hquser,"Leave");await generate(periodMonth);await leaveDecision(approved,"Cancelled",true,actors.hquser);
  let attendance=await StaffAttendance.findOne({staffId:actors.hquser.staff._id,dateKey:periodDate});assert(attendance);assert.equal(attendance.status,"Leave");assert.equal(attendance.requiresReview,true);
  const denied=await request(actors.accountant,"POST","/api/attendance/payroll/generate",{scopeType:"HQ",month:periodMonth,workingDays:20,expectedRevision:(await PayrollRun.findOne({monthKey:periodMonth})).revision},409);assert.equal(denied.code,"PAYROLL_ATTENDANCE_REVIEW_REQUIRED");
  const roster=await request(actors.hqadmin,"GET",`/api/attendance/staff/roster?scopeType=HQ&date=${periodDate}`);assert(roster.staff.find(s=>s.staffId===String(actors.hquser.staff._id)).requiresReview);
  await markAttendance(actors.hquser,"Absent");attendance=await StaffAttendance.findById(attendance._id);assert.equal(attendance.requiresReview,false);const run=await generate(periodMonth);assert.equal(run.items.find(i=>i.staffId===String(actors.hquser.staff._id)).attendanceDeduction,1000);
});
workflowTest("legacy leave with no revision/history migrates on its first guarded decision",async()=>{
  const {leave}=await applyLeave();await StaffLeave.collection.updateOne({_id:new mongoose.Types.ObjectId(leave._id)},{$unset:{revision:"",history:""}});const out=await leaveDecision({...leave,revision:0},"Approved",true);assert.equal(out.leave.revision,1);assert.equal(out.leave.history.length,1);
});
workflowTest("invalid real dates and malformed Unicode cannot create leave records",async()=>{
  const bad=await applyLeave(actors.hquser,{fromDateKey:"2026-02-30",toDateKey:"2026-02-30"},400);assert.equal(bad.code,"LEAVE_INVALID_FIELDS");await applyLeave(actors.hquser,{reason:"invalid\ud800"},400);assert.equal(await StaffLeave.countDocuments({fromDateKey:periodDate}),0);
});

workflowTest("attendance finalization racing approval cannot freeze the wrong leave status",async()=>{
  const leave=(await applyLeave()).leave;
  const roster=await request(actors.hqadmin,"GET",`/api/attendance/staff/roster?scopeType=HQ&date=${periodDate}`);
  const rows=roster.staff.map(s=>({staffType:s.staffType,staffId:s.staffId,status:"Present"}));
  const results=await Promise.all([
    fetch(`${base}/api/attendance/staff/bulk`,{method:"POST",headers:jsonHeaders(actors.hqadmin),body:JSON.stringify({scopeType:"HQ",staffCategory:"HQ_STAFF",date:periodDate,rows,finalize:true})}),
    fetch(`${base}/api/attendance/staff-leaves/${leave._id}/status`,{method:"PATCH",headers:jsonHeaders(actors.hqadmin),body:JSON.stringify({status:"Approved",isPaid:true,revision:leave.revision})}),
  ]);
  assert.equal(results[0].status,200);assert([200,409].includes(results[1].status));
  const saved=await StaffAttendance.findOne({staffId:actors.hquser.staff._id,dateKey:periodDate});const current=await StaffLeave.findById(leave._id);assert.equal(saved.isFinalized,true);
  assert.equal(saved.status,current.status==="Approved"?"Leave":"Present");
});
workflowTest("finalized attendance prevents cancellation without invalidating Reviewed payroll",async()=>{
  const approved=(await leaveDecision((await applyLeave()).leave,"Approved",true)).leave;await markAttendance(actors.hquser,"Leave");let run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;
  await StaffAttendance.updateOne({staffId:actors.hquser.staff._id,dateKey:periodDate},{$set:{isFinalized:true}});
  await leaveDecision(approved,"Cancelled",true,actors.hquser,409);const saved=await PayrollRun.findById(run._id);assert.equal(saved.status,"Reviewed");assert.equal(saved.revision,run.revision);assert.equal(saved.needsRecalculation,false);
});
workflowTest("attendance write failure rolls back payroll invalidation and keeps the old mark",async()=>{
  await markAttendance();let run=await generate(periodMonth);run=(await statusRun(run,"Reviewed")).run;const original=StaffAttendance.bulkWrite;
  StaffAttendance.bulkWrite=async()=>{throw new Error("Injected attendance-write failure")};
  try{await markAttendance(actors.hquser,"Present",500);}finally{StaffAttendance.bulkWrite=original;}
  const saved=await PayrollRun.findById(run._id);assert.equal(saved.status,"Reviewed");assert.equal(saved.revision,run.revision);assert.equal(saved.needsRecalculation,false);assert.equal((await StaffAttendance.findOne({staffId:actors.hquser.staff._id,dateKey:periodDate})).status,"Absent");
});
workflowTest("revoking the HQ Admin leave-approval permission remains effective",async()=>{
  const leave=(await applyLeave()).leave;const current=await RolePermission.findOne({role:"hqadmin"});const original=[...current.permissions];
  try{await RolePermission.updateOne({_id:current._id},{$pull:{permissions:PERMISSIONS.STAFF_LEAVE_APPROVE}});await leaveDecision(leave,"Approved",true,actors.hqadmin,403);await leaveDecision(leave,"Approved",true,actors.superadmin);}
  finally{await RolePermission.updateOne({_id:current._id},{$set:{permissions:original}});}
});
