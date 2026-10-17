import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { google } from "googleapis";
import routes from "../routes/examQuestion.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import School from "../models/School.js";
import AcademicYear from "../models/AcademicYear.js";
import Course from "../models/Course.js";
import Paper from "../models/ExamQuestionPaper.js";
import Download from "../models/ExamQuestionDownload.js";
import RolePermission from "../models/RolePermission.js";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { encryptText } from "../utils/cryptoHelper.js";
import { getRolePermissions } from "../services/permissionService.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";

// This suite refuses application database names and uses no real Drive account.
const uri = process.env.EXAM_QUESTION_TEST_MONGODB_URL;
if (!uri || !/^unis_exam_questions_test_[a-z0-9_]+$/.test(new URL(uri).pathname.slice(1))) throw new Error("Set an isolated EXAM_QUESTION_TEST_MONGODB_URL with a unis_exam_questions_test_* database name.");
const receipt = Buffer.from("%PDF-1.7\nlocal question-paper fixture\n%%EOF");
const actors = {}; let server, base, year, course, school, otherSchool, fakeDrive;
const actualDrive = google.drive, actualToken = google.auth.OAuth2.prototype.getAccessToken;
class FakeDrive {
  records = new Map([["root", { id: "root", name: "UNIS", mimeType: "application/vnd.google-apps.folder", trashed: false }]]);
  bytes = new Map(); sequence = 0; downloads = 0;
  files = {
    list: async ({ q }) => {
      const name = q.match(/name\s*=\s*'([^']+)'/)?.[1], parent = q.match(/'([^']+)' in parents/)?.[1];
      return { data: { files: [...this.records.values()].filter((r) => !r.trashed && r.mimeType === "application/vnd.google-apps.folder" && (!name || r.name === name) && (!parent || r.parents?.includes(parent))) } };
    },
    create: async ({ requestBody, media }) => {
      const record = { id: `fake-${++this.sequence}`, trashed: false, ...requestBody };
      if (media) { const chunks=[]; for await (const chunk of media.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from([chunk])); this.bytes.set(record.id, Buffer.concat(chunks)); record.size = String(this.bytes.get(record.id).length); record.mimeType = media.mimeType; }
      this.records.set(record.id, record); return { data: { ...record } };
    },
    get: async ({ fileId, alt }) => {
      if (alt === "media") { this.downloads++; return { data: this.bytes.get(fileId) }; }
      return { data: this.records.get(fileId) };
    },
    delete: async ({ fileId }) => { this.records.delete(fileId); this.bytes.delete(fileId); return { data: {} }; },
  };
}
function body(changes = {}) { return { academicYearId: String(year._id), courseId: String(course._id), studyingYear: "1", examType: "Annual", subjectNo: "1", examDate: "2026-01-10", examStartTime: "10:00", releaseDate: "2026-01-10", releaseTime: "09:00", targetType: "ALL", targetSchoolIds: [], title: "தமிழ் العربية", instructions: "വിവരണം / సూచనలు", ...changes }; }
async function request(actor, method, path, fields, { file = false, expected = 200, bytes = receipt } = {}) {
  const headers = actor ? { Authorization: `Bearer ${actor.token}` } : {};
  let payload;
  if (file) { payload = new FormData(); for (const [key, value] of Object.entries(fields || {})) payload.append(key, Array.isArray(value) ? JSON.stringify(value) : value); payload.append("file", new Blob([bytes], { type: "application/pdf" }), "question.pdf"); }
  else if (fields !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(fields); }
  const response = await fetch(base + path, { method, headers, ...(payload ? { body: payload } : {}) });
  const data = response.headers.get("content-type")?.includes("application/pdf") ? Buffer.from(await response.arrayBuffer()) : await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`); return data;
}
const create = async (changes = {}, actor = actors.superadmin) => (await request(actor, "POST", "/api/exam-questions/", body(changes), { file: true, expected: 201 })).paper;
async function update(paper, changes = {}, options = {}) { return request(actors.superadmin, "PUT", `/api/exam-questions/${paper._id}`, body(changes), options); }
async function historical(status, close = new Date("2026-01-10T06:30:00Z")) {
  const paper = await create(); await Paper.updateOne({ _id: paper._id }, { $set: { publicationStatus: status, availableUntil: close } });
  return Paper.findById(paper._id).lean();
}
before(async () => {
  process.env.JWT_SECRET = "isolated-exam-questions-test-secret"; process.env.INTEGRATION_ENC_SECRET = "isolated-exam-encryption-secret"; process.env.APP_ENV = "development";
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "root"; process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME = "UNIS";
  await mongoose.connect(uri, { autoIndex: false }); await mongoose.connection.dropDatabase();
  year = await AcademicYear.create({ acYear: "2026-2027", active: "Active" });
  course = await Course.create({ code: "C-01", name: "தமிழ் العربية", years: 3, fees: 0, subject1: "தமிழ்", subject1Code: "S-01", subject1MaxMark: 100, subject1PassMark: 35 });
  const supervisorId = new mongoose.Types.ObjectId(), districtStateId = new mongoose.Types.ObjectId();
  school = await School.create({ code: "N-01", nameEnglish: "Test Niswan", address: "Local", supervisorId, districtStateId, incharge1: "Local", incharge1Number: 123456 });
  otherSchool = await School.create({ code: "N-02", nameEnglish: "Other Niswan", address: "Local", supervisorId, districtStateId, incharge1: "Local", incharge1Number: 123456 });
  for (const [name, role] of [["superadmin","superadmin"],["hqadmin","hqadmin"],["hquser","hquser"],["accountant","accountant"],["admin","admin"],["otherAdmin","admin"],["teacher","teacher"]]) {
    const user=await User.create({ name, email: `${name}@local.test`, role, password: "isolated-test-password" });
    let staff;
    if (role !== "superadmin") staff=await Employee.create({ userId: user._id, employeeId: `TEST-${name}`, organizationType: ["hqadmin","hquser","accountant"].includes(role) ? "HQ" : "NISWAN", schoolId: ["hqadmin","hquser","accountant"].includes(role) ? null : name === "otherAdmin" ? otherSchool._id : school._id, address: "Local", contactNumber: 123456, salary: 0, active: "Active" });
    actors[name]={user,staff,token:jwt.sign({_id:String(user._id),role},process.env.JWT_SECRET)};
  }
  await IntegrationCredential.create({ key: "google_drive", refreshTokenEnc: encryptText("local-only-refresh-token"), folderId: "root" });
  fakeDrive = new FakeDrive(); google.drive=()=>fakeDrive; google.auth.OAuth2.prototype.getAccessToken=async()=>({token:"local-only-access-token"});
  const app=express();app.use(express.json());app.use("/api/exam-questions",routes);
  server=await new Promise(resolve=>{const instance=app.listen(0,"127.0.0.1",()=>resolve(instance));});base=`http://127.0.0.1:${server.address().port}`;
});
beforeEach(async()=>{await Download.deleteMany({});await Paper.deleteMany({});fakeDrive.downloads=0;});
after(async()=>{google.drive=actualDrive;google.auth.OAuth2.prototype.getAccessToken=actualToken;if(server)await new Promise(resolve=>server.close(resolve));if(mongoose.connection.readyState){await mongoose.connection.dropDatabase();await mongoose.disconnect();}});

test("new question papers are Published without a closing time",async()=>{const paper=await create();assert.equal(paper.publicationStatus,"Published");assert.equal(paper.availableUntil,null);assert.equal(paper.closeDate,"");assert.equal(paper.closeTime,"");assert.equal(paper.title,"தமிழ் العربية");assert.equal(paper.instructions,"വിവരണം / సూచనలు");const stored=await Paper.findById(paper._id);assert.equal(stored.publicationStatus,"Published");assert.equal(stored.availableUntil,null);});
for(const status of ["Draft","Closed","Published","invalid"])test(`create ignores an old client publicationStatus=${status} and closing fields`,async()=>{const paper=await create({publicationStatus:status,closeDate:"bad-date",closeTime:"99:99",availableUntil:"2026-01-11T00:00:00Z"});assert.equal(paper.publicationStatus,"Published");assert.equal(paper.availableUntil,null);});
test("HQ Admin can create through its existing permission",async()=>{const paper=await create({},actors.hqadmin);assert.equal(paper.publicationStatus,"Published");});
test("create still requires authentication and existing create permission",async()=>{await request(null,"POST","/api/exam-questions/",body(),{file:true,expected:401});for(const actor of [actors.admin,actors.teacher,actors.hquser,actors.accountant])await request(actor,"POST","/api/exam-questions/",body(),{file:true,expected:403});});
test("revoked HQ Admin create permission remains effective",async()=>{const original=await getRolePermissions("hqadmin");await RolePermission.updateOne({role:"hqadmin"},{$pull:{permissions:PERMISSIONS.EXAM_QUESTION_CREATE}});try{await request(actors.hqadmin,"POST","/api/exam-questions/",body(),{file:true,expected:403});}finally{await RolePermission.updateOne({role:"hqadmin"},{$set:{permissions:original}});}});
test("PDF remains required, signature-checked, and size-limited",async()=>{await request(actors.superadmin,"POST","/api/exam-questions/",body(),{expected:400});await request(actors.superadmin,"POST","/api/exam-questions/",body(),{file:true,expected:400,bytes:Buffer.from("not a PDF")});await request(actors.superadmin,"POST","/api/exam-questions/",body(),{file:true,expected:400,bytes:Buffer.alloc(15*1024*1024+1)});assert.equal(await Paper.countDocuments(),0);});
test("release and exam scheduling checks remain in place",async()=>{for(const changes of [{releaseTime:""},{releaseTime:"11:00"},{examDate:"2026-02-30"},{subjectNo:"9"}])await request(actors.superadmin,"POST","/api/exam-questions/",body(changes),{file:true,expected:400});});
test("new paper metadata edits stay Published with no closing time",async()=>{const paper=await create();const changed=await update(paper,{title:"திருத்தம்",publicationStatus:"Closed",closeDate:"2026-01-11",closeTime:"12:00"});assert.equal(changed.paper.publicationStatus,"Published");assert.equal(changed.paper.availableUntil,null);assert.equal(changed.paper.title,"திருத்தம்");});
for(const status of ["Draft","Closed","Published"])test(`editing historical ${status} retains its status and saved closing timestamp`,async()=>{const paper=await historical(status);const result=await update(paper,{title:"Updated",publicationStatus:status==="Draft"?"Published":"Draft",closeDate:"2030-01-01",closeTime:"14:00"});assert.equal(result.paper.publicationStatus,status);assert.equal(result.paper.availableUntil,paper.availableUntil.toISOString());assert.equal(result.paper.title,"Updated");});
test("historical closing-time constraints still prevent an invalid schedule",async()=>{const paper=await historical("Published");await update(paper,{examStartTime:"13:00"},{expected:400});assert.equal((await Paper.findById(paper._id)).examStartTime,"10:00");});
test("opening/listing records does not migrate existing Draft or Closed records",async()=>{await historical("Draft");await historical("Closed");const before=(await Paper.find().sort({_id:1}).lean()).map(p=>JSON.stringify(p));await request(actors.superadmin,"GET","/api/exam-questions/");const after=(await Paper.find().sort({_id:1}).lean()).map(p=>JSON.stringify(p));assert.deepEqual(after,before);});
test("published scheduled paper stays unavailable to Niswan before release",async()=>{const paper=await create({examDate:"2099-01-10",releaseDate:"2099-01-10"});assert.equal(paper.publicationStatus,"Published");assert.equal(paper.effectiveStatus,"Scheduled");await request(actors.admin,"GET",`/api/exam-questions/${paper._id}/file`,undefined,{expected:403});assert.equal(fakeDrive.downloads,0);assert.equal(await Download.countDocuments(),0);});
test("released no-close paper downloads and records its Niswan audit",async()=>{const paper=await create();const bytes=await request(actors.admin,"GET",`/api/exam-questions/${paper._id}/file`);assert(bytes.equals(receipt));assert.equal(fakeDrive.downloads,1);const log=await Download.findOne({questionPaperId:paper._id});assert.equal(String(log.schoolId),String(school._id));});
test("selected-school targeting and forbidden roles remain enforced",async()=>{const paper=await create({targetType:"SELECTED",targetSchoolIds:[String(school._id)]});await request(actors.otherAdmin,"GET",`/api/exam-questions/${paper._id}/file`,undefined,{expected:403});await request(actors.teacher,"GET",`/api/exam-questions/${paper._id}/file`,undefined,{expected:403});assert.equal(fakeDrive.downloads,0);await request(actors.admin,"GET",`/api/exam-questions/${paper._id}/file`);});
test("historical Draft, Closed and elapsed closing times remain unavailable",async()=>{for(const status of ["Draft","Closed","Published"]){const paper=await historical(status);await request(actors.admin,"GET",`/api/exam-questions/${paper._id}/file`,undefined,{expected:403});}assert.equal(fakeDrive.downloads,0);});
test("downloaded papers allow title/instructions but lock PDF and exam identity",async()=>{const paper=await create();await request(actors.admin,"GET",`/api/exam-questions/${paper._id}/file`);const edited=await update(paper,{title:"Updated after download",instructions:"தமிழ் العربية"});assert.equal(edited.paper.title,"Updated after download");await update(paper,{examDate:"2026-01-11"},{expected:409});await update(paper,{},{file:true,expected:409});assert.equal((await Paper.findById(paper._id)).examDate,"2026-01-10");});
test("editing an already downloaded legacy Closed paper does not reopen it",async()=>{const paper=await historical("Closed");await Download.create({questionPaperId:paper._id,schoolId:school._id,userId:actors.admin.user._id});const result=await update(paper,{title:"Closed history",publicationStatus:"Published"});assert.equal(result.paper.publicationStatus,"Closed");assert.equal(result.paper.availableUntil,paper.availableUntil.toISOString());});
test("delete safeguards and delete permission remain unchanged",async()=>{const paper=await create();await request(actors.superadmin,"DELETE",`/api/exam-questions/${paper._id}`,undefined,{expected:409});await request(actors.admin,"DELETE",`/api/exam-questions/${paper._id}`,undefined,{expected:403});assert(await Paper.exists({_id:paper._id}));});
