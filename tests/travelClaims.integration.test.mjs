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
import TravelClaimUpload from "../models/TravelClaimUpload.js";
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
import { moneyPaise, monthlyClaimInput, evidenceType } from "../utils/travelClaimPolicy.js";
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
const receipt = Buffer.from("%PDF-1.7\nlocal test evidence\n%%EOF");
const input = (changes = {}) => ({ monthKey: "2026-10", description: "பள்ளி ஆய்வு / سفر", amount: "1200.25", ...changes });
async function prepare(actor = actors.supervisor, changes = {}, expected = 200) {
  return request(actor, "POST", "/api/travel-claims/uploads", { monthKey: "2026-10", requestKey: randomUUID(), ...changes }, expected);
}
async function upload(actor, session, bytes = receipt, type = "application/pdf", expected = 200, key = randomUUID(), name = "சான்று.pdf") {
  const body = new FormData(); body.append("file", new Blob([bytes], { type }), name); body.append("uploadKey", key); body.append("revision", String(session.revision)); body.append("originalName", name);
  const response = await fetch(`${base}/api/travel-claims/uploads/${session._id}/files`, { method: "POST", headers: { Authorization: `Bearer ${actor.token}` }, body });
  const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
}
function payload(session, changes = {}) { return { ...input({ monthKey: session.monthKey }), requestKey: session.requestKey, uploadSessionId: session._id, sessionRevision: session.revision, fileKeys: session.files.map(f=>f.uploadKey), ...changes }; }
async function submitSession(actor, session, changes = {}, expected = 200) { return request(actor, "POST", "/api/travel-claims/submit", payload(session, changes), expected); }
async function submitted(actor = actors.supervisor, changes = {}) { let session=(await prepare(actor,{monthKey:changes.monthKey||"2026-10"})).upload; session=(await upload(actor,session)).upload; return (await submitSession(actor,session,changes)).claim; }
async function approve(claim, actor = actors.accountant, month = claim.monthKey, expected = 200) { return request(actor,"POST",`/api/travel-claims/${claim._id}/decision`,{decision:"Approved",revision:claim.revision,settlementMonth:month},expected); }
async function reject(claim, reason = "Please correct / திருத்தவும்", expected = 200) { return request(actors.accountant,"POST",`/api/travel-claims/${claim._id}/decision`,{decision:"Rejected",reason,revision:claim.revision},expected); }
async function legacy(status="Approved",actor=actors.supervisor,changes={}) {
  return TravelClaim.create({requestKey:randomUUID(),claimNumber:`OLD-${randomUUID()}`,userId:actor.user._id,staffType:actor.user.role==="supervisor"?"Supervisor":"Employee",staffId:actor.staff._id,name:actor.user.name,staffCode:actor.staff.employeeId||actor.staff.supervisorId,status,fromDateKey:"2026-10-01",toDateKey:"2026-10-02",settlementMonth:"2026-10",purpose:"Legacy தமிழ்",requestedAmountPaise:120025,approvedAmountPaise:status==="Submitted"?0:120025,...changes});
}
const monthlyTest = (name, fn) => test(name, async () => {
  await TravelClaim.deleteMany({}); await TravelClaimUpload.deleteMany({}); await PayrollRun.deleteMany({});
  await Employee.updateMany({organizationType:"HQ"},{$set:{active:"Active"}}); await Supervisor.updateMany({},{$set:{active:"Active"}});
  for (const record of fakeDrive.records.values()) delete record.permissions;
  await fn();
});
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


// Monthly TA regression cases.
monthlyTest("catalog and role scopes remain unchanged",async()=>{assert.equal(PERMISSION_CATALOG_VERSION,12);assert.equal(PERMISSION_KEYS.length,108);for(const role of ["supervisor","hqadmin","hquser","hqstaff","accountant"]){const data=await request(actors[role],"GET","/api/travel-claims/meta");assert(data.canManageOwn);assert.equal(data.canReview,["hqadmin","accountant"].includes(role));}});
monthlyTest("JWT, Niswan and inactive HQ identities cannot enter monthly TA",async()=>{await request(null,"GET","/api/travel-claims/mine?monthKey=2026-10",undefined,401);for(const role of ["teacher","nadmin","nstaff","guest"])await prepare(actors[role],{},403);await Employee.updateOne({_id:actors.hqstaff.staff._id},{$set:{active:"In-Active"}});await prepare(actors.hqstaff,{},403);});
monthlyTest("revoked TA manage permission cannot be restored by the monthly change",async()=>{const old=await getRolePermissions("hqstaff");await RolePermission.updateOne({role:"hqstaff"},{$pull:{permissions:PERMISSIONS.TA_SELF_MANAGE}});try{await prepare(actors.hqstaff,{},403);}finally{await RolePermission.updateOne({role:"hqstaff"},{$set:{permissions:old}});}});
monthlyTest("upload preparation creates no draft or submitted claim and is idempotent",async()=>{const key=randomUUID();const a=await prepare(actors.supervisor,{requestKey:key});const b=await prepare(actors.supervisor,{requestKey:key});assert.equal(a.upload._id,b.upload._id);assert.equal(await TravelClaim.countDocuments(),0);assert.equal(await TravelClaimUpload.countDocuments(),1);});
monthlyTest("only a completed monthly submission creates a claim and ignores forged ownership",async()=>{const claim=await submitted(actors.supervisor,{status:"Approved",userId:actors.hquser.user._id,staffId:actors.hquser.staff._id,approvedAmountPaise:999999,payrollRunId:new mongoose.Types.ObjectId(),name:"forged"});assert.equal(claim.status,"Submitted");assert.equal(String(claim.userId),String(actors.supervisor.user._id));assert.equal(claim.supervisorId,"TEST-SUP");assert.equal(claim.employeeId,"");assert.equal(claim.approvedAmountPaise,0);assert.equal(claim.payrollRunId,null);assert.equal(claim.description,"பள்ளி ஆய்வு / سفر");assert.equal(claim.role,"supervisor");assert.equal(claim.evidence[0].name,"சான்று.pdf");assert(!JSON.stringify(claim).includes("driveFileId"));});
monthlyTest("same submission retry returns one claim even after approval",async()=>{let session=(await prepare()).upload;session=(await upload(actors.supervisor,session)).upload;const a=await submitSession(actors.supervisor,session);await approve(a.claim);const b=await submitSession(actors.supervisor,session);assert.equal(a.claim._id,b.claim._id);assert.equal(b.claim.status,"Approved");assert.equal(await TravelClaim.countDocuments(),1);await submitSession(actors.supervisor,session,{amount:"1201"},409);});
monthlyTest("concurrent different sessions cannot create two claims in the same staff/month",async()=>{const sessions=[];for(let i=0;i<2;i++){let s=(await prepare()).upload;s=(await upload(actors.supervisor,s)).upload;sessions.push(s);}const responses=await Promise.all(sessions.map(s=>fetch(base+"/api/travel-claims/submit",{method:"POST",headers:jsonHeaders(actors.supervisor),body:JSON.stringify(payload(s))})));assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(await TravelClaim.countDocuments(),1);});
monthlyTest("different months are separate and employee/supervisor IDs are server snapshots",async()=>{const a=await submitted(actors.hquser);const b=await submitted(actors.hquser,{monthKey:"2026-11"});assert.notEqual(a._id,b._id);assert.equal(a.employeeId,"TEST-hquser");assert.equal(a.supervisorId,"");});
monthlyTest("month amount description and malformed Unicode are checked without rounding",async()=>{for(const amount of ["0","-1","1e3","1.001","10000000.01"])assert.throws(()=>monthlyClaimInput(input({amount})));for(const monthKey of ["2026-13","2026-00",null])assert.throws(()=>monthlyClaimInput(input({monthKey})));for(const description of ["", " ","x".repeat(2001),"bad\ud800"])assert.throws(()=>monthlyClaimInput(input({description})));assert.equal(moneyPaise("1200.25"),120025);});
monthlyTest("missing evidence, invented file keys and wrong upload ownership create no claim",async()=>{const session=(await prepare()).upload;await submitSession(actors.supervisor,session,{},400);await submitSession(actors.supervisor,session,{fileKeys:[randomUUID()]},400);await submitSession(actors.hquser,session,{},403);assert.equal(await TravelClaim.countDocuments(),0);});
monthlyTest("file magic and 3 MiB limits are checked before storage",async()=>{const s=(await prepare()).upload;await upload(actors.supervisor,s,Buffer.from("not a receipt"),"application/pdf",400);await upload(actors.supervisor,s,Buffer.alloc(3*1024*1024+1),"application/pdf",400);assert.equal((await TravelClaimUpload.findById(s._id)).evidence.length,0);});
monthlyTest("file retry checks content and filename and does not attach duplicates",async()=>{let s=(await prepare()).upload;const key=randomUUID();s=(await upload(actors.supervisor,s,receipt,"application/pdf",200,key)).upload;const again=await upload(actors.supervisor,{...s,revision:0},receipt,"application/pdf",200,key);assert.equal(again.upload.files.length,1);await upload(actors.supervisor,s,Buffer.from("%PDF-different"),"application/pdf",409,key);await upload(actors.supervisor,s,receipt,"application/pdf",409,key,"different.pdf");});
monthlyTest("file limit is five active attachments and removed files cannot be submitted",async()=>{let s=(await prepare()).upload;for(let i=0;i<5;i++)s=(await upload(actors.supervisor,s)).upload;await upload(actors.supervisor,s,receipt,"application/pdf",400);const removed=s.files[0];s=(await request(actors.supervisor,"DELETE",`/api/travel-claims/uploads/${s._id}/files/${removed._id}`,{revision:s.revision})).upload;await submitSession(actors.supervisor,s,{fileKeys:[removed.uploadKey]},400);});
monthlyTest("failed Drive upload leaves no claim and can be explicitly retried",async()=>{const s=(await prepare()).upload,original=fakeDrive.files.create;fakeDrive.files.create=async()=>{throw new Error("Injected private upload failure")};try{await upload(actors.supervisor,s,receipt,"application/pdf",503);}finally{fakeDrive.files.create=original;}assert.equal(await TravelClaim.countDocuments(),0);const ready=(await upload(actors.supervisor,s)).upload;assert.equal((await submitSession(actors.supervisor,ready)).claim.status,"Submitted");});
monthlyTest("upload metadata and receipt bytes are inaccessible to another requester",async()=>{const s=(await prepare()).upload;await upload(actors.hquser,s,receipt,"application/pdf",403);const claim=await submitted();await request(actors.hquser,"GET",`/api/travel-claims/${claim._id}`,undefined,403);await request(actors.hquser,"GET",`/api/travel-claims/${claim._id}/evidence/${claim.evidence[0]._id}`,undefined,403);});
monthlyTest("UTF-8 filenames cover every supported non-Latin script",async()=>{for(const name of ["சான்று.pdf","ثبوت.pdf","دليل.pdf","തെളിവ്.pdf","ಪುರಾವೆ.pdf","ఆధారం.pdf"]){const s=(await prepare(actors.supervisor,{monthKey:`2026-${String(1+["சான்று.pdf","ثبوت.pdf","دليل.pdf","തെളിവ്.pdf","ಪುರಾವೆ.pdf","ఆధారం.pdf"].indexOf(name)).padStart(2,"0")}`})).upload;const data=await upload(actors.supervisor,s,receipt,"application/pdf",200,randomUUID(),name);assert.equal(data.upload.files[0].name,name);await TravelClaimUpload.updateOne({_id:s._id},{$set:{expiresAt:new Date(0)}});} });
monthlyTest("expired sessions cannot submit and are not silently deleted",async()=>{let s=(await prepare()).upload;s=(await upload(actors.supervisor,s)).upload;await TravelClaimUpload.updateOne({_id:s._id},{$set:{expiresAt:new Date(0)}});const data=await submitSession(actors.supervisor,s,{},409);assert.equal(data.code,"TA_UPLOAD_EXPIRED");assert(await TravelClaimUpload.exists({_id:s._id}));});
monthlyTest("public Drive roots refuse uploads",async()=>{const s=(await prepare()).upload;fakeDrive.records.get("root").permissions=[{type:"anyone",role:"reader"}];await upload(actors.supervisor,s,receipt,"application/pdf",409);assert.equal(await TravelClaim.countDocuments(),0);});
monthlyTest("tampered stored receipts and public receipt sharing refuse download",async()=>{const claim=await submitted();const saved=await TravelClaim.findById(claim._id),file=saved.evidence[0],original=fakeDrive.bytes.get(file.driveFileId);fakeDrive.bytes.set(file.driveFileId,Buffer.from("%PDF-changed"));await request(actors.supervisor,"GET",`/api/travel-claims/${claim._id}/evidence/${file._id}`,undefined,409);fakeDrive.bytes.set(file.driveFileId,original);fakeDrive.records.get(file.driveFileId).permissions=[{type:"domain",role:"reader"}];await request(actors.supervisor,"GET",`/api/travel-claims/${claim._id}/evidence/${file._id}`,undefined,409);});
monthlyTest("old draft edit cancel return and evidence mutation endpoints cannot write",async()=>{const claim=await submitted();for(const [method,path,body]of [["POST","/",input()],["PATCH",`/${claim._id}`,{description:"changed"}],["POST",`/${claim._id}/status`,{action:"Cancel",revision:claim.revision}],["DELETE",`/${claim._id}/evidence/${claim.evidence[0]._id}`,{revision:claim.revision}]]){const result=await request(actors.supervisor,method,"/api/travel-claims"+path,body,409);assert.equal(result.code,"TA_MONTHLY_REQUIRED");}assert.equal((await TravelClaim.findById(claim._id)).status,"Submitted");});
monthlyTest("only finance reviewers decide and self-approval is blocked",async()=>{const claim=await submitted(actors.accountant);await approve(claim,actors.accountant,claim.monthKey,403);for(const role of ["supervisor","hquser","hqstaff"])await approve(claim,actors[role],claim.monthKey,403);assert.equal((await approve(claim,actors.hqadmin)).claim.status,"Approved");});
monthlyTest("approval must equal requested amount and rejection requires a valid reason",async()=>{const claim=await submitted();for(const body of [{decision:"Returned"},{decision:"Approved",approvedAmount:"100"},{decision:"Approved",settlementMonth:"2026-11"},{decision:"Rejected",reason:""},{decision:"Rejected",reason:"bad\ud800"}])await request(actors.accountant,"POST",`/api/travel-claims/${claim._id}/decision`,{revision:claim.revision,...body},400);const approved=(await approve(claim)).claim;assert.equal(approved.approvedAmountPaise,120025);});
monthlyTest("rejection resubmits same monthly record and preserves full decision history",async()=>{let claim=(await reject(await submitted())).claim;let s=(await prepare(actors.supervisor,{claimId:claim._id})).upload;const result=await submitSession(actors.supervisor,s,{claimRevision:claim.revision,keptEvidenceIds:claim.evidence.map(e=>e._id),amount:"1300.50",description:"திருத்தம் / تصحيح"});assert.equal(result.claim._id,claim._id);assert.equal(result.claim.status,"Submitted");assert.equal(result.claim.requestedAmountPaise,130050);assert.deepEqual(result.claim.history.map(e=>e.action),["Submitted","Rejected","Submitted"]);assert.equal(result.claim.history[1].reason,"Please correct / திருத்தவும்");assert.equal(await TravelClaim.countDocuments(),1);});
monthlyTest("resubmission removes replaced evidence but keeps historical metadata",async()=>{const rejected=(await reject(await submitted())).claim;let s=(await prepare(actors.supervisor,{claimId:rejected._id})).upload;s=(await upload(actors.supervisor,s)).upload;const result=await submitSession(actors.supervisor,s,{claimRevision:rejected.revision,keptEvidenceIds:[]});assert.equal(result.claim.evidence.length,1);const stored=await TravelClaim.findById(rejected._id);assert.equal(stored.evidence.length,2);assert(stored.evidence[0].removed);await request(actors.supervisor,"GET",`/api/travel-claims/${rejected._id}/evidence/${rejected.evidence[0]._id}`,undefined,404);});
monthlyTest("concurrent approvals have one winner and one decision event",async()=>{const claim=await submitted();const results=await Promise.all(["Approved","Rejected"].map(decision=>fetch(`${base}/api/travel-claims/${claim._id}/decision`,{method:"POST",headers:jsonHeaders(actors.accountant),body:JSON.stringify({decision,reason:"Review",revision:claim.revision})})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await TravelClaim.findById(claim._id)).history.length,2);});
monthlyTest("submission failure rolls back both claim and closed upload session",async()=>{let s=(await prepare()).upload;s=(await upload(actors.supervisor,s)).upload;const original=TravelClaimUpload.prototype.save;TravelClaimUpload.prototype.save=function(...args){if(this.submittedClaimId)throw new Error("Injected close failure");return original.apply(this,args)};try{await submitSession(actors.supervisor,s,{},503);}finally{TravelClaimUpload.prototype.save=original;}assert.equal(await TravelClaim.countDocuments(),0);assert.equal((await TravelClaimUpload.findById(s._id)).submittedClaimId,undefined);await submitSession(actors.supervisor,s);});
monthlyTest("payroll selects Approved only for the matching month with no fixed TA",async()=>{await approve(await submitted());await submitted(actors.hquser);const rejected=(await reject(await submitted(actors.hqstaff))).claim;await approve(await submitted(actors.supervisor,{monthKey:"2026-11",amount:"500"}));const run=await generate();const item=run.items.find(i=>i.staffId===String(actors.supervisor.staff._id));assert.equal(item.travellingAllowance,0);assert.equal(item.grossSalary,10000);assert.equal(item.approvedTaClaims,1200.25);assert.equal(item.netSalary,11200.25);assert.equal(item.travelClaimItems.length,1);for(const role of ["hquser","hqstaff","hqadmin"])assert.equal(run.items.find(i=>i.staffId===String(actors[role].staff._id)).approvedTaClaims,0);assert.equal((await TravelClaim.findById(rejected._id)).status,"Rejected");});
monthlyTest("payroll recalculation never doubles TA and preserves manual adjustments",async()=>{await approve(await submitted());let run=await generate();const item=run.items.find(i=>i.staffId===String(actors.supervisor.staff._id));run=(await request(actors.accountant,"PATCH",`/api/attendance/payroll/${run._id}/items/${item._id}`,{manualAllowance:100,manualDeduction:20,expectedRevision:run.revision})).run;const next=await generate();const changed=next.items.find(i=>i.staffId===String(actors.supervisor.staff._id));assert.equal(changed.approvedTaClaims,1200.25);assert.equal(changed.manualAllowance,100);assert.equal(changed.manualDeduction,20);assert.equal(changed.travelClaimItems.length,1);});
monthlyTest("approval invalidates Reviewed payroll and forces recalculation",async()=>{const claim=await submitted();let run=await generate();run=(await statusRun(run,"Reviewed")).run;await approve(claim);const invalid=await PayrollRun.findById(run._id);assert.equal(invalid.status,"Draft");assert(invalid.needsRecalculation);await statusRun(invalid,"Reviewed",409);const rebuilt=await generate();assert.equal(rebuilt.items.find(i=>i.staffId===String(actors.supervisor.staff._id)).approvedTaClaims,1200.25);});
monthlyTest("Finalized payroll blocks new submissions, resubmissions and approvals",async()=>{const claim=await submitted();const rejected=(await reject(await submitted(actors.hquser))).claim;let run=await generate();run=(await statusRun(run,"Reviewed")).run;await statusRun(run,"Finalized");const a=await prepare(actors.hqstaff,{},409);assert.equal(a.code,"TA_MONTH_LOCKED");await prepare(actors.hquser,{claimId:rejected._id},409);await approve(claim,actors.accountant,claim.monthKey,409);assert.equal((await TravelClaim.findById(claim._id)).status,"Submitted");});
monthlyTest("approval racing finalization cannot omit an approved request",async()=>{const claim=await submitted();let run=await generate();run=(await statusRun(run,"Reviewed")).run;const results=await Promise.all([fetch(`${base}/api/travel-claims/${claim._id}/decision`,{method:"POST",headers:jsonHeaders(actors.accountant),body:JSON.stringify({decision:"Approved",revision:claim.revision})}),fetch(`${base}/api/attendance/payroll/${run._id}/status`,{method:"PATCH",headers:jsonHeaders(actors.accountant),body:JSON.stringify({status:"Finalized",expectedRevision:run.revision})})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const saved=await TravelClaim.findById(claim._id),payroll=await PayrollRun.findById(run._id);if(saved.status==="Approved"){assert.equal(payroll.status,"Draft");assert(payroll.needsRecalculation);}else assert.equal(payroll.status,"Finalized");});
monthlyTest("payment leaves monthly TA Approved and cannot reimburse it again",async()=>{const claim=(await approve(await submitted())).claim;let run=await generate();run=(await statusRun(run,"Reviewed")).run;run=(await statusRun(run,"Finalized")).run;run=(await statusRun(run,"Paid")).run;const stored=await TravelClaim.findById(claim._id);assert.equal(stored.status,"Approved");assert(stored.paidAt);assert.equal(String(stored.payrollRunId),run._id);const repeated=await statusRun(run,"Paid");assert.equal(repeated.run.revision,run.revision);assert.equal((await TravelClaim.findById(claim._id)).history.filter(e=>e.action==="Paid").length,1);const later=await generate("2026-11");assert.equal(later.items.find(i=>i.staffId===String(actors.supervisor.staff._id)).approvedTaClaims,0);const mine=await request(actors.supervisor,"GET","/api/travel-claims/mine?monthKey=2026-10&status=Approved");assert.equal(mine.claims[0].status,"Approved");});
monthlyTest("mid-payment failure rolls back all TA payments and payroll status",async()=>{await approve(await submitted());await approve(await submitted(actors.hquser));let run=await generate();run=(await statusRun(run,"Reviewed")).run;run=(await statusRun(run,"Finalized")).run;const original=TravelClaim.prototype.save;let saves=0;TravelClaim.prototype.save=function(...args){if(this.paidAt&&++saves===2)throw new Error("Injected payment failure");return original.apply(this,args)};try{await statusRun(run,"Paid",500);}finally{TravelClaim.prototype.save=original;}assert.equal((await PayrollRun.findById(run._id)).status,"Finalized");assert.equal(await TravelClaim.countDocuments({paidAt:{$ne:null}}),0);await statusRun(run,"Paid");});
monthlyTest("inactive staff allocation is released without changing Approved status",async()=>{const claim=(await approve(await submitted())).claim;await generate();await Supervisor.updateOne({_id:actors.supervisor.staff._id},{$set:{active:"In-Active"}});const run=await generate();const stored=await TravelClaim.findById(claim._id);assert.equal(stored.status,"Approved");assert.equal(stored.payrollRunId,null);assert(!run.items.some(i=>i.staffId===String(actors.supervisor.staff._id)));});
monthlyTest("monthly report shows IDs, unique eligible counts and non-submitted staff",async()=>{await approve(await submitted());await submitted(actors.hquser);await reject(await submitted(actors.hqstaff));const result=await request(actors.accountant,"GET","/api/travel-claims/monthly-report?monthKey=2026-10");assert.deepEqual(result.summary,{eligible:5,approved:1,submitted:1,rejected:1,notSubmitted:2});const pending=await request(actors.hqadmin,"GET","/api/travel-claims/monthly-report?monthKey=2026-10&status=Not%20submitted");assert.equal(pending.total,2);assert(pending.rows.every(r=>r.employeeId&&!r.supervisorId));const all=await request(actors.accountant,"GET","/api/travel-claims/monthly-report/export?monthKey=2026-10&category=Supervisor");assert.equal(all.rows.length,1);assert.equal(all.rows[0].supervisorId,"TEST-SUP");await request(actors.hquser,"GET","/api/travel-claims/monthly-report?monthKey=2026-10",undefined,403);});
monthlyTest("monthly filters use literal search, reject invalid months, and do not leak other staff",async()=>{await submitted();await submitted(actors.hquser);const mine=await request(actors.hquser,"GET","/api/travel-claims/mine?monthKey=2026-10");assert.equal(mine.claims.length,1);assert.equal(mine.claims[0].employeeId,"TEST-hquser");const literal=await request(actors.accountant,"GET","/api/travel-claims/review?monthKey=2026-10&search=.*");assert.equal(literal.claims.length,0);await request(actors.accountant,"GET","/api/travel-claims/monthly-report?monthKey=2026-13",undefined,400);});
monthlyTest("legacy Submitted and approved or allocated claims block duplicate monthly requests",async()=>{for(const status of ["Submitted","Approved","PayrollReserved","Paid"]){await TravelClaim.deleteMany({});await legacy(status);const result=await prepare(actors.supervisor,{},409);assert.equal(result.code,"TA_LEGACY_MONTH_EXISTS");}});
monthlyTest("legacy unsubmitted drafts stay preserved outside counts and cannot be edited",async()=>{const old=await legacy("Draft");const report=await request(actors.accountant,"GET","/api/travel-claims/monthly-report?monthKey=2026-10");assert.equal(report.summary.notSubmitted,5);const list=await request(actors.supervisor,"GET","/api/travel-claims/mine?monthKey=2026-10");assert.equal(list.claims.length,0);await submitted();assert.equal(await TravelClaim.countDocuments(),2);assert.equal((await TravelClaim.findById(old._id)).status,"Draft");});
monthlyTest("legacy approvals retain allocations and public status remains Approved",async()=>{const old=await legacy();let run=await generate();const stored=await TravelClaim.findById(old._id);assert.equal(stored.status,"PayrollReserved");assert.equal(String(stored.payrollRunId),run._id);const projected=await request(actors.accountant,"GET",`/api/travel-claims/${old._id}`);assert.equal(projected.claim.status,"Approved");run=(await statusRun(run,"Reviewed")).run;run=(await statusRun(run,"Finalized")).run;await statusRun(run,"Paid");assert.equal((await TravelClaim.findById(old._id)).status,"Paid");assert.equal((await request(actors.supervisor,"GET",`/api/travel-claims/${old._id}`)).claim.status,"Approved");});
monthlyTest("audit decisions exclude private evidence bytes and JWTs",async()=>{await approve(await submitted());const log=await AuditLog.findOne({action:"TA_DECISION",success:true}).lean();assert(log);assert(!JSON.stringify(log).includes(actors.accountant.token));assert(!JSON.stringify(log).includes("local test evidence"));});

monthlyTest("non-submitted eligibility respects current revoked permissions and inactive profiles",async()=>{
  const original=await getRolePermissions("hqstaff");await RolePermission.updateOne({role:"hqstaff"},{$pull:{permissions:PERMISSIONS.TA_SELF_MANAGE}});await Supervisor.updateOne({_id:actors.supervisor.staff._id},{$set:{active:"In-Active"}});
  try{const report=await request(actors.accountant,"GET","/api/travel-claims/monthly-report?monthKey=2026-10&status=Not%20submitted");assert.equal(report.summary.eligible,3);assert(!report.rows.some(row=>["hqstaff","supervisor"].includes(row.role)));}
  finally{await RolePermission.updateOne({role:"hqstaff"},{$set:{permissions:original}});}
});
monthlyTest("historical fixed-TA payroll snapshots remain byte-for-byte unchanged",async()=>{
  const old=await PayrollRun.create({monthKey:"2026-09",organizationType:"HQ",status:"Paid",workingDays:20,generatedBy:actors.accountant.user._id,items:[{staffType:"Supervisor",staffId:actors.supervisor.staff._id,userId:actors.supervisor.user._id,staffCode:"TEST-SUP",name:actors.supervisor.user.name,role:"supervisor",monthlySalary:10000,travellingAllowance:2500,grossSalary:12500,workingDays:20,payableDays:20,netSalary:12500}]});
  const before=JSON.stringify(await PayrollRun.findById(old._id).lean());await approve(await submitted());await generate();assert.equal(JSON.stringify(await PayrollRun.findById(old._id).lean()),before);
});
monthlyTest("monthly unique index prevents duplicate records even outside the API lock",async()=>{
  const claim=await submitted();const stored=(await TravelClaim.findById(claim._id)).toObject();delete stored._id;stored.requestKey=randomUUID();stored.claimNumber=`DUP-${randomUUID()}`;await assert.rejects(TravelClaim.create(stored),error=>error.code===11000);assert.equal(await TravelClaim.countDocuments(),1);
});
monthlyTest("an upload opened before month closure cannot submit after payroll finalization",async()=>{
  let session=(await prepare()).upload;session=(await upload(actors.supervisor,session)).upload;let run=await generate();run=(await statusRun(run,"Reviewed")).run;await statusRun(run,"Finalized");const data=await submitSession(actors.supervisor,session,{},409);assert.equal(data.code,"TA_MONTH_LOCKED");assert.equal(await TravelClaim.countDocuments(),0);
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
