import multer from "multer";
import Certificate from "../models/Certificate.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import Template from "../models/Template.js";
import Academic from "../models/Academic.js";
import { createCanvas, loadImage, registerFont } from "canvas";
import * as fs from 'fs';
import * as path from 'path';
import { put } from "@vercel/blob";
import redisClient from "../db/redis.js"

const upload = multer({});

const addCertificate = async (req, res) => {
  try {
    const {
      templateId,
      schoolId,
      studentId,
    } = req.body;

    const template = await Template.findById({ _id: templateId })
      .populate({ path: 'courseId', select: '_id name' });

    console.log("CourseId - " + template.courseId._id);
    if (!template) {
      return res
        .status(404)
        .json({ success: false, error: "Template not found." });
    }

    const school = await School.findById({ _id: schoolId })
    if (!school) {
      return res
        .status(404)
        .json({ success: false, error: "School not found." });
    }

    const student = await Student.findById({ _id: studentId })
      .populate("userId", { password: 0, profileImage: 0 });

    console.log("Student Roll Number : " + student.rollNumber);

    // Get academic START year
    const academicStart = await Academic.findOne({
      $or: [{ 'courseId1': template.courseId }, { 'courseId2': template.courseId }, { 'courseId3': template.courseId }, { 'courseId4': template.courseId }, { 'courseId5': template.courseId }],
      $and: [{
        'studentId': studentId
      }]
    }).sort({ createdAt: 1 }).limit(1)
      .populate({ path: 'acYear', select: 'acYear' });

    if (!academicStart || !academicStart.acYear || !academicStart.acYear.acYear) {
      return res
        .status(404)
        .json({ success: false, error: "Academics not found for the Student." });
    }

    let startYear = academicStart.acYear.acYear.substr(0, 4);
    console.log("Academic Start Year : " + startYear);

    // Get academic END year
    const academicEnd = await Academic.findOne({
      $or: [{ 'courseId1': template.courseId }, { 'courseId2': template.courseId }, { 'courseId3': template.courseId }, { 'courseId4': template.courseId }, { 'courseId5': template.courseId }],
      $and: [{
        'studentId': studentId
      }]
    }).sort({ createdAt: -1 }).limit(1)
      .populate({ path: 'acYear', select: 'acYear' });

    let endYear = academicEnd.acYear.acYear.substr(5, 4);
    console.log("Academic End Year : " + endYear);

    let certificateNum;
    if (!template.courseId.name.includes("Makthab")) {
      const cert = await Certificate.findOne({ templateId: templateId, studentId: studentId });
      if (cert) {
        return res
          .status(404)
          .json({ success: false, error: "Certificate Already Found. No : " + cert.code });
      }

      await Certificate.findOne({}).sort({ _id: -1 }).limit(1).then((certificate, err) => {
        if (certificate) {
          certificateNum = Number(certificate.code) + 1;
        } else {
          certificateNum = Number(new Date().getFullYear() + "00000") + 1;
        }
      })
    }

    // Get the template image.
    const image = await loadImage(template.template.replace("?download=1", ""));

    //-----------------------------
    try {

      let response = await fetch('https://www.unis.org.in/Nirmalab.ttc');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      let arrayBuffer = await response.arrayBuffer();
      let fontBuffer = Buffer.from(arrayBuffer);

      let tempFontPath = path.join('/tmp', 'Nirmalab.ttc');
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, {
        family: "Nirmala"
      });
      //  fs.closeSync();

      response = await fetch('https://www.unis.org.in/DUBAI-BOLD.TTF');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      arrayBuffer = await response.arrayBuffer();
      fontBuffer = Buffer.from(arrayBuffer);

      tempFontPath = path.join('/tmp', 'DUBAI-BOLD.TTF');
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, {
        family: "DUBAI-BOLD"
      });
      //  fs.closeSync();

      response = await fetch('https://www.unis.org.in/arial.ttf');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      arrayBuffer = await response.arrayBuffer();
      fontBuffer = Buffer.from(arrayBuffer);

      tempFontPath = path.join('/tmp', 'Arial.ttf');
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, {
        family: "Arial"
      });
      //  fs.closeSync();

      response = await fetch('https://www.unis.org.in/arialbd.ttf');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      arrayBuffer = await response.arrayBuffer();
      fontBuffer = Buffer.from(arrayBuffer);

      tempFontPath = path.join('/tmp', 'Arial-Bold.ttf');
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, {
        family: "Arial-Bold"
      });

      response = await fetch('https://www.unis.org.in/COMICZ.TTF');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      arrayBuffer = await response.arrayBuffer();
      fontBuffer = Buffer.from(arrayBuffer);

      tempFontPath = path.join('/tmp', 'COMICZ.TTF');
      fs.writeFileSync(tempFontPath, fontBuffer);
      registerFont(tempFontPath, {
        family: "Comic"
      });

      //  fs.closeSync();

    } catch (error) {
      console.log(error);
      return res
        .status(500)
        .json({ success: false, error: "Font setting Error." + error.toString() });
    }
    //------------------------------------

    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    // context.drawImage(image, 0, 0);
    context.drawImage(image, 0, 0, image.width, image.height);

    // Niswan Name in Arabic
    let nameArabic = school.nameArabic ? school.nameArabic : "";
    console.log("Arabic length : " + nameArabic.length)
    if (nameArabic.length <= 30) {
      context.font = '46px DUBAI-BOLD';
    } else if (nameArabic.length <= 43) {
      context.font = '41px DUBAI-BOLD';
    } else if (nameArabic.length <= 51) {
      context.font = '35px DUBAI-BOLD';
    } else {
      context.font = '32px DUBAI-BOLD';
    }
    context.fillStyle = 'rgb(14, 84, 49)';
    context.textAlign = 'center';
    context.fillText(nameArabic, image.width / 2, 189);

    let nameNativeOrEnglish = school.nameNative ? school.nameNative : school.nameEnglish ? school.nameEnglish.toUpperCase() : "";
    console.log("Native / English length : " + nameNativeOrEnglish.length)
    if (nameNativeOrEnglish.length <= 22) {
      context.font = 'bold 34px Nirmala';
    } else if (nameNativeOrEnglish.length <= 51) {
      context.font = 'bold 30px Nirmala';
    } else {
      context.font = 'bold 27px Nirmala';
    }
    // context.font = 'bold 34px Nirmala';
    //context.fillStyle = 'red';
    context.fillStyle = 'rgb(161, 14, 94)';
    context.textAlign = 'center';
    context.fillText(nameNativeOrEnglish, image.width / 2, 244);
    context.fillText(nameNativeOrEnglish, image.width / 2, 245);
    context.fillText(nameNativeOrEnglish, (image.width / 2) + 1, 245);

    context.font = 'bold 21px Arial-Bold';
    context.fillStyle = 'rgb(4, 25, 93)';
    context.textAlign = 'center';
    context.fillText(school.address ? school.address + ", " + school.district : "", image.width / 2, 289);

    //  context.font = 'bold 25px Arial-Bold';
    //context.font = '25px Comic';
    context.fillStyle = 'rgb(14, 56, 194)';
    context.textAlign = 'start';

    let name = student.userId.name ? student.userId.name : "";
    let rollNumber = student.rollNumber ? student.rollNumber : "";
    let fatherName = student.fatherName ? student.fatherName : student.motherName ? student.motherName : student.guardianName ? student.guardianName : "";

    //  context.font = '25px Arial';
    let dat = (new Date()).toLocaleDateString();
    let fileName = template.courseId.name + "_" + rollNumber + "_" + name + "_" + new Date().getTime() + ".png";
    let base64String;

    // For Muballiga and Muallama (only saved to DB)
    if (!template.courseId.name.includes("Makthab")) {

      context.font = '25px Comic';
      context.fillText(name.toUpperCase(), 370, 790);
      context.fillText(fatherName.toUpperCase(), 249, 840);

      context.font = 'bold 23px Arial-Bold';
      context.fillText(rollNumber.toUpperCase(), 1150, 790);

      context.fillText("JUNE-" + startYear, 475, 890);
      context.fillText("APRIL-" + endYear, 672, 890);

      context.fillText(certificateNum, 259, 1475);
      context.fillText(dat, 260, 1510);

      const blob = await put("certificates/" + fileName, canvas.toBuffer('image/png', { resolution: 250 }), {
        access: 'public',
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      const newCertificate = new Certificate({
        code: certificateNum,
        templateId: templateId,
        courseId: template.courseId._id,
        studentId: studentId,
        schoolId: schoolId,
        userId: student.userId,
        certificate: blob.downloadUrl,
      });

      await newCertificate.save();
      console.log("Saved : " + certificateNum + ", File Name : " + fileName);

      await redisClient.set('totalCertificates', await Certificate.countDocuments());

      return res.status(200).json({ success: true, message: "Certificate Created Successfully.", image: blob.downloadUrl, fileName: fileName, type: 'url' });

    } else {
      // For Other than Muballiga and Muallama (NOT saved to DB)

      context.font = '25px Comic';
      context.fillText(name.toUpperCase(), 395, 832);
      context.fillText(fatherName.toUpperCase(), 335, 886);

      context.font = 'bold 23px Arial-Bold';
      context.fillText(rollNumber.toUpperCase(), 1100, 832);
      context.fillText(new Date().getFullYear(), 640, 1000);
      context.fillText(dat, 260, 1472);

      base64String = canvas.toDataURL("image/png", 1.0).split(',')[1];

      console.log("Created File Name : " + fileName);

      return res.status(200).json({ success: true, message: "Certificate Created Successfully.", image: base64String, fileName: fileName, type: 'base64' });
    }

    // To use a hexadecimal color:
    // ctx.fillStyle = '#00FF00'; // Green

    // To use an RGBA color:
    // ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; // Semi-transparent red

    // To create a gradient fill:
    //const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    //gradient.addColorStop(0, 'white');
    //gradient.addColorStop(1, 'black');
    //ctx.fillStyle = gradient;

    //  return res.status(200).json({ success: true, message: "Certificate Created Successfully.", image: base64String, fileName: fileName });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in create certificate." });
  }
};

const getCertificates = async (req, res) => {
  try {
    const certificates = await Certificate.find({}).select('code')
      .populate({ path: 'templateId', select: 'code' })
      .populate({ path: 'courseId', select: 'name' })
      .populate({ path: 'studentId', select: 'rollNumber' })
      .populate({ path: 'userId', select: 'name' })
      .populate({ path: 'schoolId', select: 'code nameEnglish' })

    console.log("Result Sent");
    return res.status(200).json({ success: true, certificates });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get certificates server error" });
  }
};

const getByCertFilter = async (req, res) => {

  const { certSchoolId, certCourseId, certACYearId } = req.params;

  console.log("getByCertFilter : " + certSchoolId + ", " + certCourseId + ",  " + certACYearId);

  try {

    let filterQuery = Certificate.find().select('code');

    if (certSchoolId && certSchoolId?.length > 0 && certSchoolId != 'null' && certSchoolId != 'undefined') {

      console.log("School Id Added : " + certSchoolId);
      filterQuery = filterQuery.where('schoolId').in(certSchoolId);
    }

    if (certCourseId && certCourseId?.length > 0 && certCourseId != 'null' && certCourseId != 'undefined') {

      console.log("Course Id Added : " + certCourseId);
      filterQuery = filterQuery.where('courseId').in(certCourseId);
    }

    if (certACYearId && certACYearId?.length > 0 && certACYearId != 'null' && certACYearId != 'undefined') {

      console.log("acYear Added : " + certACYearId);

      const academics = await Academic.find({ acYear: certACYearId })
      let studentIds = [];
      academics.forEach(academic => studentIds.push(academic.studentId));
      console.log("Student Ids : " + studentIds)
      filterQuery = filterQuery.where('studentId').in(studentIds);
    }

    filterQuery.sort({ code: 1 });
    filterQuery.populate({ path: 'templateId', select: 'code' })
      .populate({ path: 'courseId', select: 'name' })
      .populate({ path: 'studentId', select: 'rollNumber' })
      .populate({ path: 'userId', select: 'name' })
      .populate({ path: 'schoolId', select: 'code nameEnglish' })

    // console.log(filterQuery);

    const certificates = await filterQuery.exec();

    console.log("Certificates : " + certificates?.length)
    return res.status(200).json({ success: true, certificates });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get Certificates by FILTER server error" });
  }
};

const getCertificate = async (req, res) => {
  const { id } = req.params;
  try {
    let certificate = await Certificate.findById({ _id: id })
      .populate({ path: 'templateId', select: 'code' })
      .populate({ path: 'courseId', select: 'name' })
      .populate({ path: 'studentId', select: 'rollNumber' })
      .populate({ path: 'userId', select: 'name' })
      .populate({ path: 'schoolId', select: 'code nameEnglish' });

    console.log("Result Sent");
    return res.status(200).json({ success: true, certificate });

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get certificate server error" });
  }
};

export { addCertificate, upload, getCertificates, getCertificate, getByCertFilter };
