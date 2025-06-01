import multer from "multer";
import Certificate from "../models/Certificate.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import Template from "../models/Template.js";
import Academic from "../models/Academic.js";
import { createCanvas, loadImage, registerFont } from "canvas";
import * as fs from 'fs';
import * as path from 'path';

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

    const academicStart = await Academic.findOne({
      $or: [{ 'courseId1': template.courseId }, { 'courseId2': template.courseId }, { 'courseId3': template.courseId }, { 'courseId4': template.courseId }, { 'courseId5': template.courseId }],
      $and: [{
        'studentId': studentId
      }]
    }).sort({ createdAt: 1 }).limit(1)
      .populate({ path: 'acYear', select: 'acYear' });

    if (!academicStart) {
      return res
        .status(404)
        .json({ success: false, error: "Course not found for the Student." });
    }

    let startYear = academicStart.acYear.acYear.substr(0, 4);
    console.log("Academic Start Year : " + startYear);

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
          .json({ success: false, error: "Certificate Already Found." });
      }

      await Certificate.findOne({}).sort({ _id: -1 }).limit(1).then((certificate, err) => {
        if (certificate) {
          certificateNum = Number(certificate.code) + 1;
        } else {
          certificateNum = Number(new Date().getFullYear() + "00000") + 1;
        }
      })
    }

    const imageBuffer = Buffer.from(template.template, 'base64');
    const image = await loadImage(imageBuffer);

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

    } catch (error) {
      console.log(error);
      return res
        .status(500)
        .json({ success: false, error: "Font setting Error." + error.toString() });
    }
    //------------------------------------

    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);

    // Niswan Name in Arabic
    context.font = '46px DUBAI-BOLD'; // Sans Bold
    context.fillStyle = 'rgb(14, 84, 49)'; // 'darkgreen';
    context.textAlign = 'center';
    let nameArabic = school.nameArabic ? school.nameArabic : "";
    context.fillText(nameArabic, image.width / 2, 190);

    context.font = 'bold 34px Nirmala';
    //context.fillStyle = 'red';
    context.fillStyle = 'rgb(161, 14, 94)';
    context.textAlign = 'center';
    let nameNativeOrEnglish = school.nameNative ? school.nameNative : school.nameEnglish ? school.nameEnglish.toUpperCase() : "";
    context.fillText(nameNativeOrEnglish, image.width / 2, 245);

    context.font = 'bold 22px Arial';
    context.fillStyle = 'rgb(4, 25, 93)';
    context.textAlign = 'center';
    context.fillText(school.address ? school.address : "", image.width / 2, 290);

    context.font = 'bold 25px Arial-Bold';
    context.fillStyle = 'rgb(14, 56, 194)';
    context.textAlign = 'start';

    let name = student.userId.name ? student.userId.name : "";
    let rollNumber = student.rollNumber ? student.rollNumber : "";
    let fatherName = student.fatherName ? student.fatherName : student.motherName ? student.motherName : student.guardianName ? student.guardianName : "";

    context.font = '25px Arial';
    let dat = (new Date()).toLocaleDateString();
    let fileName = template.courseId.name + "_" + rollNumber + "_" + name;
    let base64String;

    // For Muballiga and Muallama (only saved to DB)
    if (!template.courseId.name.includes("Makthab")) {

      context.fillText(name.toUpperCase(), 370, 790);
      context.fillText(rollNumber.toUpperCase(), 1150, 790);
      context.fillText(fatherName.toUpperCase(), 250, 840);
      context.fillText(startYear, 500, 890);
      context.fillText(endYear, 700, 890);
      context.fillText(certificateNum, 260, 1475);
      context.fillText(dat, 260, 1510);

      base64String = canvas.toDataURL().split(',')[1];

      const newCertificate = new Certificate({
        code: certificateNum,
        templateId: templateId,
        courseId: template.courseId._id,
        studentId: studentId,
        schoolId: schoolId,
        userId: student.userId,
        certificate: base64String,
      });

      await newCertificate.save();
      console.log("Saved : " + certificateNum + ", File Name : " + fileName);

    } else {
      // For Other than Muballiga and Muallama (NOT saved to DB)

      context.fillText(name.toUpperCase(), 395, 832);
      context.fillText(rollNumber.toUpperCase(), 1100, 832);
      context.fillText(fatherName.toUpperCase(), 335, 886);
      context.fillText(new Date().getFullYear(), 640, 1000);
      context.fillText(dat, 260, 1472);

      base64String = canvas.toDataURL().split(',')[1];

      console.log("Created File Name : " + fileName);
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

    return res.status(200).json({ success: true, message: "Certificate Created Successfully.", image: base64String, fileName: fileName });
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

const getCertificate = async (req, res) => {
  const { id } = req.params;
  try {
    let certificate = await Certificate.findById({ _id: id })
      .populate({ path: 'templateId', select: 'code' })
      .populate({ path: 'courseId', select: 'name' })
      .populate({ path: 'studentId', select: 'rollNumber' })
      .populate({ path: 'userId', select: 'name' })
      .populate({ path: 'schoolId', select: 'code nameEnglish' })

    console.log("Result Sent");
    return res.status(200).json({ success: true, certificate });

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get certificate server error" });
  }
};

export { addCertificate, upload, getCertificates, getCertificate };
