import mongoose from "mongoose";

import connectToDatabase from "../db/db.js";
import Academic from "../models/Academic.js";
import AcademicYear from "../models/AcademicYear.js";
import Certificate from "../models/Certificate.js";
import FeeInvoice from "../models/FeeInvoice.js";
import Student from "../models/Student.js";
import Template from "../models/Template.js";
import { getNextNumber } from "../controllers/commonController.js";

const APPLY = String(process.env.APPLY || "false").toLowerCase() === "true";
const SCHOOL_ID = String(process.env.SCHOOL_ID || "").trim();
const COURSE_ID = String(process.env.COURSE_ID || "").trim();
const DEFAULT_CERTIFICATE_FEES = 75;

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const getId = (value) => String(value?._id || value || "");

const getTemplateFee = (template) => {
  const fee = Number(template?.certificateFees);
  return Number.isFinite(fee) && fee >= 0 ? fee : DEFAULT_CERTIFICATE_FEES;
};

const findCompletedStudentsForCourse = async (courseId, schoolId = "") => {
  const academics = await Academic.find({
    $or: [
      { courseId1: courseId, status1: "Completed" },
      { courseId2: courseId, status2: "Completed" },
      { courseId3: courseId, status3: "Completed" },
      { courseId4: courseId, status4: "Completed" },
      { courseId5: courseId, status5: "Completed" },
    ],
  })
    .select("_id studentId acYear courseId1 courseId2 courseId3 courseId4 courseId5 status1 status2 status3 status4 status5")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const latestAcademicByStudent = new Map();

  for (const academic of academics) {
    const sid = getId(academic.studentId);
    if (!sid || latestAcademicByStudent.has(sid)) continue;
    latestAcademicByStudent.set(sid, academic);
  }

  const studentIds = [...latestAcademicByStudent.keys()].filter(isObjectId);
  if (studentIds.length === 0) return [];

  const students = await Student.find({
    _id: { $in: studentIds },
    ...(schoolId ? { schoolId } : {}),
  })
    .select("_id userId schoolId rollNumber")
    .lean();

  return students.map((student) => ({
    student,
    academic: latestAcademicByStudent.get(getId(student._id)),
  }));
};

const main = async () => {
  await connectToDatabase();

  if (SCHOOL_ID && !isObjectId(SCHOOL_ID)) {
    throw new Error("Invalid SCHOOL_ID");
  }

  if (COURSE_ID && !isObjectId(COURSE_ID)) {
    throw new Error("Invalid COURSE_ID");
  }

  const activeYear = await AcademicYear.findOne({ active: "Active" }).select("_id acYear").lean();
  if (!activeYear?._id) {
    throw new Error("Active academic year not configured");
  }

  const templates = await Template.find({
    ...(COURSE_ID ? { courseId: COURSE_ID } : {}),
  })
    .select("_id courseId certificateFees")
    .populate({ path: "courseId", select: "_id name" })
    .lean();

  const summary = {
    dryRun: !APPLY,
    activeAcYear: activeYear.acYear,
    templatesChecked: templates.length,
    completedStudentsChecked: 0,
    invoicesToCreate: 0,
    invoicesCreated: 0,
    skippedAlreadyCertificate: 0,
    skippedExistingInvoice: 0,
    skippedFreeTemplate: 0,
    errors: [],
  };

  for (const template of templates) {
    const courseId = getId(template.courseId);
    const certificateFees = getTemplateFee(template);

    if (!courseId || certificateFees <= 0) {
      summary.skippedFreeTemplate++;
      continue;
    }

    const rows = await findCompletedStudentsForCourse(courseId, SCHOOL_ID);
    summary.completedStudentsChecked += rows.length;

    for (const { student, academic } of rows) {
      try {
        const existingCertificate = await Certificate.findOne({
          templateId: template._id,
          studentId: student._id,
        })
          .select("_id code")
          .lean();

        if (existingCertificate) {
          summary.skippedAlreadyCertificate++;
          continue;
        }

        const existingInvoice = await FeeInvoice.findOne({
          studentId: student._id,
          courseId,
          source: "CERTIFICATE",
          status: { $in: ["ISSUED", "PARTIAL", "PAID"] },
        })
          .select("_id invoiceNo status")
          .lean();

        if (existingInvoice) {
          summary.skippedExistingInvoice++;
          continue;
        }

        summary.invoicesToCreate++;

        if (!APPLY) continue;

        const invoiceNo = await getNextNumber({
          name: "Invoice",
          prefix: "INV",
          pad: 7,
        });

        await FeeInvoice.create({
          invoiceNo,
          schoolId: student.schoolId,
          studentId: student._id,
          userId: student.userId,
          acYear: activeYear._id,
          academicId: academic._id,
          courseId,
          courseNamesText: template.courseId?.name || "",
          source: "CERTIFICATE",
          items: [
            {
              headCode: "CERTIFICATE",
              headName: "Certificate Fee",
              amount: certificateFees,
              discount: 0,
              fine: 0,
              netAmount: certificateFees,
              paidAmount: 0,
            },
          ],
          total: certificateFees,
          paidTotal: 0,
          balance: certificateFees,
          status: "ISSUED",
          notes: "Certificate fee invoice - completed student backfill",
        });

        summary.invoicesCreated++;
      } catch (error) {
        summary.errors.push({
          studentId: getId(student?._id),
          rollNumber: student?.rollNumber || "",
          reason: error?.message || "Unknown error",
        });
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
