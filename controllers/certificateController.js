import multer from "multer";
import Certificate from "../models/Certificate.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import Template from "../models/Template.js";
import Academic from "../models/Academic.js";
import { createCanvas, loadImage, registerFont } from "canvas";

import { google } from "googleapis";
import { Readable } from "stream";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { decryptText } from "../utils/cryptoHelper.js";

import * as fs from "fs";
import * as path from "path";
import getRedis from "../db/redis.js";

const upload = multer({});

// ---------------- Google Drive helpers (Certificates) ----------------
const buildDriveClient = async () => {
  const cred = await IntegrationCredential.findOne({ key: "google_drive" }).lean();
  if (!cred?.refreshTokenEnc) throw new Error("Google Drive not connected");

  const refreshToken = decryptText(cred.refreshTokenEnc);

  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: "v3", auth: oAuth2Client });
  return { drive };
};

const findChildFolderId = async (drive, parentId, folderName) => {
  const safeName = String(folderName).replace(/'/g, "\\'");
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${safeName}'`,
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const res = await drive.files.list({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 1,
  });

  return res.data.files?.[0]?.id || null;
};

const createFolder = async (drive, parentId, folderName) => {
  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });

  return res.data.id;
};

const ensureFolderPath = async (drive, parts = []) => {
  let parentId = null;
  for (const name of parts) {
    let id = await findChildFolderId(drive, parentId, name);
    if (!id) id = await createFolder(drive, parentId, name);
    parentId = id;
  }
  return parentId;
};

const drivePreviewUrl = (fileId) => `https://drive.google.com/uc?export=view&id=${fileId}`;
const driveDownloadUrl = (fileId) => `https://drive.google.com/uc?export=download&id=${fileId}`;

const pad2 = (n) => String(n).padStart(2, "0");
const formatTs = (d = new Date()) => {
  const DD = pad2(d.getDate());
  const MM = pad2(d.getMonth() + 1);
  const YYYY = d.getFullYear();
  const HH = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${DD}${MM}${YYYY}${HH}${mm}${ss}`;
};

const buildTimestampedName = (originalName = "file.png") => {
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = dot > 0 ? originalName.slice(dot) : ".png";
  const safeBase = base
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${safeBase || "file"}_${formatTs()}${ext}`;
};

const uploadBufferToDrive = async (drive, folderId, fileName, buffer, mimeType) => {
  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: "id,name,webViewLink",
  });

  const fileId = res.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: { type: "anyone", role: "reader" },
  });

  return {
    fileId,
    fileName: res.data.name,
    viewUrl: res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    previewUrl: drivePreviewUrl(fileId),
    downloadUrl: driveDownloadUrl(fileId),
  };
};
// --------------------------------------------------------------------

const addCertificate = async (req, res) => {
  try {
    const { templateId, schoolId, studentId } = req.body;

    const template = await Template.findById({ _id: templateId }).populate({
      path: "courseId",
      select: "_id name",
    });

    console.log("CourseId - " + template?.courseId?._id);

    if (!template) {
      return res.status(404).json({ success: false, error: "Template not found." });
    }

    const school = await School.findById({ _id: schoolId });
    if (!school) {
      return res.status(404).json({ success: false, error: "School not found." });
    }

    const student = await Student.findById({ _id: studentId }).populate("userId", {
      password: 0,
      profileImage: 0,
    });

    console.log("Student Roll Number : " + student?.rollNumber);

    // Get academic START year
    const academicStart = await Academic.findOne({
      $or: [
        { courseId1: template.courseId },
        { courseId2: template.courseId },
        { courseId3: template.courseId },
        { courseId4: template.courseId },
        { courseId5: template.courseId },
      ],
      $and: [{ studentId: studentId }],
    })
      .sort({ createdAt: 1 })
      .limit(1)
      .populate({ path: "acYear", select: "acYear" });

    if (!academicStart || !academicStart.acYear || !academicStart.acYear.acYear) {
      return res.status(404).json({ success: false, error: "Academics not found for the Student." });
    }

    let startYear = academicStart.acYear.acYear.substr(0, 4);
    console.log("Academic Start Year : " + startYear);

    // Get academic END year
    const academicEnd = await Academic.findOne({
      $or: [
        { courseId1: template.courseId },
        { courseId2: template.courseId },
        { courseId3: template.courseId },
        { courseId4: template.courseId },
        { courseId5: template.courseId },
      ],
      $and: [{ studentId: studentId }],
    })
      .sort({ createdAt: -1 })
      .limit(1)
      .populate({ path: "acYear", select: "acYear" });

    let endYear = academicEnd.acYear.acYear.substr(5, 4);
    console.log("Academic End Year : " + endYear);

    let certificateNum;
    if (!template.courseId.name.includes("Makthab")) {
      const cert = await Certificate.findOne({ templateId: templateId, studentId: studentId });
      if (cert) {
        return res.status(404).json({
          success: false,
          error: "Certificate Already Found. No : " + cert.code,
        });
      }

      await Certificate.findOne({})
        .sort({ _id: -1 })
        .limit(1)
        .then((certificate) => {
          if (certificate) certificateNum = Number(certificate.code) + 1;
          else certificateNum = Number(new Date().getFullYear() + "00000") + 1;
        });
    }

    // Get the template image (still from Vercel Blob URL for now)
    const image = await loadImage(String(template.template || "").replace("?download=1", ""));

    //----------------------------- Fonts -----------------------------
    try {
      let response = await fetch("https://www.unis.org.in/Nirmalab.ttc");
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      let arrayBuffer = await response.arrayBuffer();
      let fontBuffer = Buffer.from(arrayBuffer);
      let tempFontPath = path.join("/tmp", "Nirmalab.ttc");
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, { family: "Nirmala" });

      response = await fetch("https://www.unis.org.in/DUBAI-BOLD.TTF");
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      arrayBuffer = await response.arrayBuffer();
      fontBuffer = Buffer.from(arrayBuffer);
      tempFontPath = path.join("/tmp", "DUBAI-BOLD.TTF");
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, { family: "DUBAI-BOLD" });

      response = await fetch("https://www.unis.org.in/arial.ttf");
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      arrayBuffer = await response.arrayBuffer();
      fontBuffer = Buffer.from(arrayBuffer);
      tempFontPath = path.join("/tmp", "Arial.ttf");
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, { family: "Arial" });

      response = await fetch("https://www.unis.org.in/arialbd.ttf");
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      arrayBuffer = await response.arrayBuffer();
      fontBuffer = Buffer.from(arrayBuffer);
      tempFontPath = path.join("/tmp", "Arial-Bold.ttf");
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, { family: "Arial-Bold" });

      response = await fetch("https://www.unis.org.in/COMICZ.TTF");
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      arrayBuffer = await response.arrayBuffer();
      fontBuffer = Buffer.from(arrayBuffer);
      tempFontPath = path.join("/tmp", "COMICZ.TTF");
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, { family: "Comic" });
    } catch (error) {
      console.log(error);
      return res.status(500).json({ success: false, error: "Font setting Error." + error.toString() });
    }
    //------------------------------------

    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, image.width, image.height);

    // Niswan Name in Arabic
    let nameArabic = school.nameArabic ? school.nameArabic : "";
    console.log("Arabic length : " + nameArabic.length);
    if (nameArabic.length <= 30) context.font = "46px DUBAI-BOLD";
    else if (nameArabic.length <= 43) context.font = "41px DUBAI-BOLD";
    else if (nameArabic.length <= 51) context.font = "35px DUBAI-BOLD";
    else context.font = "32px DUBAI-BOLD";
    context.fillStyle = "rgb(14, 84, 49)";
    context.textAlign = "center";
    context.fillText(nameArabic, image.width / 2, 189);

    let nameNativeOrEnglish = school.nameNative
      ? school.nameNative
      : school.nameEnglish
        ? school.nameEnglish.toUpperCase()
        : "";
    console.log("Native / English length : " + nameNativeOrEnglish.length);
    if (nameNativeOrEnglish.length <= 22) context.font = "bold 34px Nirmala";
    else if (nameNativeOrEnglish.length <= 51) context.font = "bold 30px Nirmala";
    else context.font = "bold 27px Nirmala";
    context.fillStyle = "rgb(161, 14, 94)";
    context.textAlign = "center";
    context.fillText(nameNativeOrEnglish, image.width / 2, 244);
    context.fillText(nameNativeOrEnglish, image.width / 2, 245);
    context.fillText(nameNativeOrEnglish, image.width / 2 + 1, 245);

    context.font = "bold 21px Arial-Bold";
    context.fillStyle = "rgb(4, 25, 93)";
    context.textAlign = "center";
    context.fillText(school.address ? school.address + ", " + school.district : "", image.width / 2, 289);

    context.fillStyle = "rgb(14, 56, 194)";
    context.textAlign = "start";

    let name = student.userId.name ? student.userId.name : "";
    let rollNumber = student.rollNumber ? student.rollNumber : "";
    let fatherName = student.fatherName
      ? student.fatherName
      : student.motherName
        ? student.motherName
        : student.guardianName
          ? student.guardianName
          : "";

    let dat = new Date().toLocaleDateString();
    let fileName = template.courseId.name + "_" + rollNumber + "_" + name + "_" + new Date().getTime() + ".png";
    let base64String;

    // For Muballiga and Muallama (only saved to DB)
    if (!template.courseId.name.includes("Makthab")) {
      context.font = "25px Comic";
      context.fillText(name.toUpperCase(), 370, 790);
      context.fillText(fatherName.toUpperCase(), 249, 840);

      context.font = "bold 23px Arial-Bold";
      context.fillText(rollNumber.toUpperCase(), 1150, 790);

      context.fillText("JUNE-" + startYear, 475, 890);
      context.fillText("APRIL-" + endYear, 672, 890);

      context.fillText(certificateNum, 259, 1475);
      context.fillText(dat, 260, 1510);

      // ✅ Upload to Google Drive instead of Vercel Blob
      const { drive } = await buildDriveClient();
      const folderId = await ensureFolderPath(drive, ["UNIS", "Certificates"]);

      const outName = buildTimestampedName(fileName);
      const pngBuffer = canvas.toBuffer("image/png", { resolution: 250 });

      const uploaded = await uploadBufferToDrive(drive, folderId, outName, pngBuffer, "image/png");

      const newCertificate = new Certificate({
        code: certificateNum,
        templateId: templateId,
        courseId: template.courseId._id,
        studentId: studentId,
        schoolId: schoolId,
        userId: student.userId,

        // legacy: store Drive preview URL here so existing UI <img src> still works
        certificate: uploaded.previewUrl,

        // drive fields
        certificateDriveFileId: uploaded.fileId,
        certificateDriveViewUrl: uploaded.viewUrl,
        certificateDriveDownloadUrl: uploaded.downloadUrl,
        certificateDrivePreviewUrl: uploaded.previewUrl,
        certificateFileName: uploaded.fileName,
      });

      await newCertificate.save();
      console.log("Saved : " + certificateNum + ", File Name : " + uploaded.fileName);

      const redis = await getRedis();
      await redis.set("totalCertificates", await Certificate.countDocuments());

      return res.status(200).json({
        success: true,
        message: "Certificate Created Successfully.",
        image: uploaded.downloadUrl, // for Add.jsx download
        downloadUrl: uploaded.downloadUrl,
        viewUrl: uploaded.previewUrl,
        fileName: uploaded.fileName,
        type: "url",
      });
    } else {
      // For Other than Muballiga and Muallama (NOT saved to DB)
      context.font = "25px Comic";
      context.fillText(name.toUpperCase(), 395, 832);
      context.fillText(fatherName.toUpperCase(), 335, 886);

      context.font = "bold 23px Arial-Bold";
      context.fillText(rollNumber.toUpperCase(), 1100, 832);
      context.fillText(new Date().getFullYear(), 640, 1000);
      context.fillText(dat, 260, 1472);

      base64String = canvas.toDataURL("image/png", 1.0).split(",")[1];

      console.log("Created File Name : " + fileName);

      return res.status(200).json({
        success: true,
        message: "Certificate Created Successfully.",
        image: base64String,
        fileName: fileName,
        type: "base64",
      });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "server error in create certificate." });
  }
};

const getCertificates = async (req, res) => {
  try {
    const certificates = await Certificate.find({})
      .select("code")
      .populate({ path: "templateId", select: "code" })
      .populate({ path: "courseId", select: "name" })
      .populate({ path: "studentId", select: "rollNumber fatherName motherName guardianName" })
      .populate({ path: "userId", select: "name" })
      .populate({ path: "schoolId", select: "code nameEnglish" });

    console.log("Result Sent");
    return res.status(200).json({ success: true, certificates });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get certificates server error" });
  }
};

const getByCertFilter = async (req, res) => {
  const { certSchoolId, certCourseId, certACYearId } = req.params;

  console.log("getByCertFilter : " + certSchoolId + ", " + certCourseId + ",  " + certACYearId);

  try {
    let filterQuery = Certificate.find().select("code");

    if (certSchoolId && certSchoolId?.length > 0 && certSchoolId != "null" && certSchoolId != "undefined") {
      console.log("School Id Added : " + certSchoolId);
      filterQuery = filterQuery.where("schoolId").in(certSchoolId);
    }

    if (certCourseId && certCourseId?.length > 0 && certCourseId != "null" && certCourseId != "undefined") {
      console.log("Course Id Added : " + certCourseId);
      filterQuery = filterQuery.where("courseId").in(certCourseId);
    }

    if (certACYearId && certACYearId?.length > 0 && certACYearId != "null" && certACYearId != "undefined") {
      console.log("acYear Added : " + certACYearId);

      const academics = await Academic.find({ acYear: certACYearId });
      let studentIds = [];
      academics.forEach((academic) => studentIds.push(academic.studentId));
      console.log("Student Ids : " + studentIds);
      filterQuery = filterQuery.where("studentId").in(studentIds);
    }

    filterQuery.sort({ code: 1 });
    filterQuery
      .populate({ path: "templateId", select: "code" })
      .populate({ path: "courseId", select: "name" })
      .populate({ path: "studentId", select: "rollNumber fatherName motherName guardianName" })
      .populate({ path: "userId", select: "name" })
      .populate({ path: "schoolId", select: "code nameEnglish" });

    const certificates = await filterQuery.exec();

    console.log("Certificates : " + certificates?.length);
    return res.status(200).json({ success: true, certificates });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get Certificates by FILTER server error" });
  }
};

const getCertificate = async (req, res) => {
  const { id } = req.params;
  try {
    let certificate = await Certificate.findById({ _id: id })
      .populate({ path: "templateId", select: "code" })
      .populate({ path: "courseId", select: "name" })
      .populate({ path: "studentId", select: "rollNumber fatherName motherName guardianName" })
      .populate({ path: "userId", select: "name" })
      .populate({ path: "schoolId", select: "code nameEnglish" });

    //console.log("Result Sent");
    return res.status(200).json({ success: true, certificate });
  } catch (error) {
    //console.log(error);
    return res.status(500).json({ success: false, error: "get certificate server error" });
  }
};

export { addCertificate, upload, getCertificates, getCertificate, getByCertFilter };