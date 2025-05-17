import multer from "multer";
import Certificate from "../models/Certificate.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import Template from "../models/Template.js";
import { createCanvas, loadImage, registerFont } from "canvas";
import * as fs from 'fs';

const upload = multer({});

const addCertificate = async (req, res) => {
  try {
    const {
      templateId,
      schoolId,
      studentId,
    } = req.body;

    const template = await Template.findById({ _id: templateId });
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

    let certificateNum;
    if (!template.code.includes("Makthab")) {
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

    registerFont('ariblk.ttf', { family: 'Arial' });
    registerFont('Nirmala.ttc', { family: 'Nirmala-UI' });
    registerFont('DUBAI-BOLD.TTF', { family: 'DUBAI-BOLD' });

   // registerFont('comicsans.ttf', { family: 'Comic Sans' })

    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);

    // Niswan Name in Arabic
    context.font = 'bold 46px DUBAI-BOLD';
    context.fillStyle = 'rgb(14, 84, 49)'; // 'darkgreen';
    context.textAlign = 'center';
    let nameArabic = school.nameArabic ? school.nameArabic : "";
    context.fillText(nameArabic, image.width / 2, 190);

    context.font = 'bold 34px Nirmala-UI';
    //context.fillStyle = 'red';
    context.fillStyle = 'rgb(161, 14, 94)';
    context.textAlign = 'center';
    let nameNativeOrEnglish = school.nameNative ? school.nameNative : school.nameEnglish ? school.nameEnglish.toUpperCase() : "";
    context.fillText(nameNativeOrEnglish, image.width / 2, 245);

    context.font = 'bold 22px Arial';
    context.fillStyle = 'rgb(4, 25, 93)';
    context.textAlign = 'center';
    context.fillText(school.address ? school.address : "", image.width / 2, 290);

    context.font = 'bold 25px Arial';
    context.fillStyle = 'rgb(14, 56, 194)';
    context.textAlign = 'start';

    let name = student.userId.name ? student.userId.name : "";
    let rollNumber = student.rollNumber ? student.rollNumber : "";
    let fatherName = student.fatherName ? student.fatherName : student.motherName ? student.motherName : student.guardianName ? student.guardianName : "";
    let dat = (new Date()).toLocaleDateString();
    let fileName = template.code + "_" + rollNumber + "_" + name;
    let base64String;

    // For Muballiga and Muallama (only saved to DB)
    if (!template.code.includes("Makthab")) {

      context.fillText(name.toUpperCase(), 370, 790);
      context.fillText(rollNumber.toUpperCase(), 1150, 790);
      context.fillText(fatherName.toUpperCase(), 250, 840);
      context.fillText(certificateNum, 260, 1475);
      context.fillText(dat, 260, 1510);

      base64String = canvas.toDataURL().split(',')[1];

      const newCertificate = new Certificate({
        code: certificateNum,
        templateId: templateId,
        studentId: studentId,
        schoolId: schoolId,
        userId: student.userId,
        certificate: base64String,
      });

      await newCertificate.save();
      console.log("Saved : " + certificateNum + ", File Name : " + fileName);

    } else {

      context.fillText(name.toUpperCase(), 395, 832);
      context.fillText(rollNumber.toUpperCase(), 1100, 832);
      context.fillText(fatherName.toUpperCase(), 322, 886);
      // context.fillText(certificateNum, 260, 1475);
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
      .populate({ path: 'studentId', select: 'rollNumber' })
      .populate({ path: 'userId', select: 'name' })
      .populate({ path: 'schoolId', select: 'nameEnglish' })

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
      .populate({ path: 'studentId', select: 'rollNumber' })
      .populate({ path: 'userId', select: 'name' })
      .populate({ path: 'schoolId', select: 'nameEnglish' })

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
