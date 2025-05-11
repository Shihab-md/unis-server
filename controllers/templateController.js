import multer from "multer";
import Template from "../models/Template.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import { createCanvas, loadImage } from "canvas";
import * as fs from 'fs';

const upload = multer({});

const addTemplate = async (req, res) => {
  try {
    const {
      code,
      details,
    } = req.body;

    const newTemplate = new Template({
      code,
      details,
      template: req.file ? req.file.buffer.toString('base64') : "",
    });

    await newTemplate.save();
    return res.status(200).json({ success: true, message: "Template Created Successfully." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding template" });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await Template.find();
    return res.status(200).json({ success: true, templates });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get templates server error" });
  }
};

const getTemplate = async (req, res) => {
  const { id } = req.params;
  try {
    let template = await Template.findById({ _id: id });

    return res.status(200).json({ success: true, template });

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get template server error" });
  }
};

const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { details, } = req.body;

    const template = await Template.findById({ _id: id });
    if (!template) {
      return res
        .status(404)
        .json({ success: false, error: "Template not found." });
    }

    let updateTemplate;
    if (req.file) {
      updateTemplate = await Template.findByIdAndUpdate({ _id: id },
        {
          details,
          template: req.file.buffer.toString('base64'),
        })
    } else {
      updateTemplate = await Template.findByIdAndUpdate({ _id: id }, { details, })
    }

    if (!updateTemplate) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "Template details updated Successfully." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update templates server error" });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteTemplate = await Template.findById({ _id: id })
    //await User.findByIdAndDelete({ _id: deleteTemplate.userId._id })
    await deleteTemplate.deleteOne()

    return res.status(200).json({ success: true, updateTemplate })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete Template server error" })
  }
}

const createCertificate = async (req, res) => {
  try {
    const {
      templateId,
      schoolId,
      studentId,
    } = req.body;

    //  console.log(templateId, "  ", schoolId, "  ", studentId);

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

    const students = await Student.find({ _id: studentId })
      .populate("userId", { password: 0, profileImage: 0 });

    const imageBuffer = Buffer.from(template.template, 'base64');

    const image = await loadImage(imageBuffer);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');

    students.map(student => {

      context.drawImage(image, 0, 0);

      context.font = '41px Arial';
      context.fillStyle = 'darkgreen';
      context.textAlign = 'center';
      context.fillText(school.nameArabic ? school.nameArabic : "", image.width / 2, 130);

      context.font = '28px Nirmala UI';
      context.fillStyle = 'red';
      context.textAlign = 'center';
      context.fillText(school.nameNative ? school.nameNative : "", image.width / 2, 175);

      context.font = '18px Arial';
      context.fillStyle = 'black';
      context.textAlign = 'center';
      context.fillText(school.address ? school.address : "", image.width / 2, 205);

      context.font = '21px Arial';
      context.fillStyle = 'blue';
      context.textAlign = 'start';
      context.fillText(student.userId.name ? student.userId.name : "", 275, 570);
      context.fillText(student.rollNumber ? student.rollNumber : "", 795, 570);
      context.fillText(student.fatherName ? student.fatherName : "", 195, 600);

      const base64String = canvas.toDataURL().split(',')[1];

      fs.writeFileSync("C:\\UNIS\\" + student.rollNumber + ".jpg", base64String, 'base64');
    });

    return res.status(200).json({ success: true, message: "Certificate Created Successfully." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding template" });
  }
};

export { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate, createCertificate };
