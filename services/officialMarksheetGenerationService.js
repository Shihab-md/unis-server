import mongoose from "mongoose";
import MarksheetExam from "../models/MarksheetExam.js";
import MarksheetStudent from "../models/MarksheetStudent.js";
import Template from "../models/Template.js";
import {
  buildMarksheetResultFolderParts,
  deleteGeneratedMarksheetPdfFromDrive,
  uploadGeneratedMarksheetPdfToDrive,
} from "./marksheetPdfDriveService.js";
import {
  fetchTemplatePdfBuffer,
  isMuballigaCourse,
  renderMuballigaIndividualExamPdfs,
} from "./muballigaIndividualMarksheetService.js";

const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());

const fileSafe = (value, fallback = "marksheet") =>
  clean(value || fallback)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;

const safeError = (error) => clean(error?.message || error) || "Official marksheet PDF generation failed.";

const getTemplate = async (courseId) => {
  const template = await Template.findOne({
    courseId,
    templateModule: "MARKSHEET",
    marksheetType: "NORMAL",
  })
    .select("_id courseId template version updatedAt")
    .lean();

  if (!template || !clean(template.template) || clean(template.template) === "-") {
    throw new Error("Normal marksheet PDF template not found for this course. Please upload it in Templates module.");
  }
  return template;
};

const getGenerationData = async (examId) => {
  const exam = await MarksheetExam.findById(examId)
    .populate("schoolId", "code nameEnglish address pincode")
    .populate("acYear", "acYear active")
    .populate("courseId")
    .lean();

  if (!exam) throw new Error("Marksheet exam not found.");
  if (exam.status !== "Finalized") throw new Error("Official marksheet PDF is available only after finalization.");
  if (!isMuballigaCourse(exam.courseId || {})) {
    throw new Error("Official Individual marksheet generation is currently enabled only for Muballiga.");
  }

  const records = await MarksheetStudent.find({ marksheetExamId: examId, status: "Finalized" })
    .populate({ path: "studentId", select: "rollNumber userId active", populate: { path: "userId", select: "name" } })
    .sort({ createdAt: 1 })
    .lean();

  if (records.length === 0) throw new Error("No finalized student marksheet records found.");
  if (Number(exam.totalStudents || 0) > 0 && records.length !== Number(exam.totalStudents || 0)) {
    throw new Error("Finalized marksheet student count does not match the exam total. PDF generation stopped for safety.");
  }

  const template = await getTemplate(exam.courseId?._id || exam.courseId);
  return { exam, records, template };
};

const cleanupFiles = async (fileIds = []) => {
  const ids = [...new Set(fileIds.map((id) => clean(id)).filter(Boolean))];
  await Promise.allSettled(ids.map((id) => deleteGeneratedMarksheetPdfFromDrive(id)));
};

export const generateOfficialMuballigaIndividualMarksheets = async ({ examId, requestedBy = null }) => {
  const requestedAt = new Date();
  const newUploadIds = [];

  const staleGeneratingBefore = new Date(requestedAt.getTime() - 10 * 60 * 1000);
  const beforeExam = await MarksheetExam.findOneAndUpdate(
    {
      _id: examId,
      status: "Finalized",
      $or: [
        { "marksheetPdf.status": { $ne: "Generating" } },
        { "marksheetPdf.requestedAt": { $lt: staleGeneratingBefore } },
      ],
    },
    {
      $set: {
        "marksheetPdf.status": "Generating",
        "marksheetPdf.requestedBy": requestedBy || null,
        "marksheetPdf.requestedAt": requestedAt,
        "marksheetPdf.lastError": "",
        "marksheetPdf.generatedAt": null,
        updatedBy: requestedBy || null,
        updatedAt: requestedAt,
      },
    },
    { new: false }
  ).lean();

  if (!beforeExam) {
    const current = await MarksheetExam.findById(examId).select("status marksheetPdf.status").lean();
    if (!current) throw new Error("Marksheet exam not found.");
    if (current.status !== "Finalized") throw new Error("Official marksheet PDF is available only after finalization.");
    if (current?.marksheetPdf?.status === "Generating") throw new Error("Official marksheet PDF generation is already in progress.");
    throw new Error("Unable to start official marksheet PDF generation.");
  }

  const oldCombinedId = clean(beforeExam?.marksheetPdf?.combinedDriveFileId);
  const oldRecords = await MarksheetStudent.find({ marksheetExamId: examId }).select("_id marksheetPdf.driveFileId").lean();
  const oldStudentIds = oldRecords.map((record) => clean(record?.marksheetPdf?.driveFileId)).filter(Boolean);

  try {
    const { exam, records, template } = await getGenerationData(examId);
    const templateBuffer = await fetchTemplatePdfBuffer(template.template);
    const rendered = await renderMuballigaIndividualExamPdfs({ templateBuffer, exam, records });

    const individualFolderParts = buildMarksheetResultFolderParts({
      academicYear: exam.acYear?.acYear,
      schoolCode: exam.schoolId?.code,
      courseCode: exam.courseId?.code || exam.courseId?.name,
      studyingYear: exam.studyingYear,
      examType: exam.examType,
      artifactType: "Individual",
    });
    const combinedFolderParts = buildMarksheetResultFolderParts({
      academicYear: exam.acYear?.acYear,
      schoolCode: exam.schoolId?.code,
      courseCode: exam.courseId?.code || exam.courseId?.name,
      studyingYear: exam.studyingYear,
      examType: exam.examType,
      artifactType: "Combined",
    });

    const individualUploads = [];
    for (const item of rendered.individual) {
      const fileName = `${fileSafe(exam.courseId?.code || "MUBALLIGA")}_${fileSafe(exam.examType)}_${fileSafe(exam.acYear?.acYear)}_${fileSafe(item.rollNumber || item.recordId)}.pdf`;
      const uploaded = await uploadGeneratedMarksheetPdfToDrive({
        buffer: item.buffer,
        fileName,
        folderParts: individualFolderParts,
      });
      newUploadIds.push(uploaded.fileId);
      individualUploads.push({ ...item, uploaded });
    }

    const combinedFileName = `${fileSafe(exam.courseId?.code || "MUBALLIGA")}_${fileSafe(exam.examType)}_${fileSafe(exam.acYear?.acYear)}_ALL.pdf`;
    const combinedUpload = await uploadGeneratedMarksheetPdfToDrive({
      buffer: rendered.combinedBuffer,
      fileName: combinedFileName,
      folderParts: combinedFolderParts,
    });
    newUploadIds.push(combinedUpload.fileId);

    const generatedAt = new Date();
    const templateVersion = Number(template.version || 1);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await MarksheetStudent.bulkWrite(
          individualUploads.map((item) => ({
            updateOne: {
              filter: { _id: item.recordId, marksheetExamId: examId, status: "Finalized" },
              update: {
                $set: {
                  marksheetPdf: {
                    driveFileId: item.uploaded.fileId,
                    fileName: item.uploaded.fileName,
                    fileSize: item.uploaded.fileSize,
                    templateVersion,
                    generatedAt,
                  },
                  updatedAt: generatedAt,
                },
              },
            },
          })),
          { ordered: true, session }
        );

        const updatedExam = await MarksheetExam.findOneAndUpdate(
          {
            _id: examId,
            status: "Finalized",
            "marksheetPdf.status": "Generating",
            "marksheetPdf.requestedAt": requestedAt,
          },
          {
            $set: {
              "marksheetPdf.status": "Generated",
              "marksheetPdf.templateVersion": templateVersion,
              "marksheetPdf.combinedDriveFileId": combinedUpload.fileId,
              "marksheetPdf.combinedFileName": combinedUpload.fileName,
              "marksheetPdf.combinedFileSize": combinedUpload.fileSize,
              "marksheetPdf.folderPath": combinedUpload.folderPath,
              "marksheetPdf.individualGeneratedCount": individualUploads.length,
              "marksheetPdf.requestedBy": requestedBy || null,
              "marksheetPdf.requestedAt": requestedAt,
              "marksheetPdf.generatedAt": generatedAt,
              "marksheetPdf.lastError": "",
              updatedBy: requestedBy || null,
              updatedAt: generatedAt,
            },
          },
          { new: true, session }
        );
        if (!updatedExam) throw new Error("Marksheet PDF generation state changed before completion. Please retry.");
      });
    } finally {
      await session.endSession();
    }

    // Remove previous official versions only after the replacement is fully committed.
    await cleanupFiles([oldCombinedId, ...oldStudentIds].filter((id) => !newUploadIds.includes(id)));

    return {
      generatedAt,
      templateVersion,
      combinedFileName: combinedUpload.fileName,
      combinedFileSize: combinedUpload.fileSize,
      individualGeneratedCount: individualUploads.length,
      totalStudents: records.length,
    };
  } catch (error) {
    await cleanupFiles(newUploadIds);
    const message = safeError(error).slice(0, 1000);
    await MarksheetExam.findOneAndUpdate(
      {
        _id: examId,
        "marksheetPdf.status": "Generating",
        "marksheetPdf.requestedAt": requestedAt,
      },
      {
        $set: {
          "marksheetPdf.status": "Failed",
          "marksheetPdf.lastError": message,
          "marksheetPdf.requestedBy": requestedBy || null,
          "marksheetPdf.requestedAt": requestedAt,
          "marksheetPdf.generatedAt": null,
          updatedBy: requestedBy || null,
          updatedAt: new Date(),
        },
      }
    );
    throw error;
  }
};
