import multer from "multer";
import Template from "../models/Template.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import { Jimp, loadFont } from "jimp";
//import { OPEN_SANS_32_WHITE } from "jimp/fonts";

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

    console.log(templateId, "  ", schoolId, "  ", studentId);

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

    console.log(students);

    const font = await loadFont(Jimp.FONT_SANS_128_WHITE);

    const image = await Jimp.read(Buffer.from(template.template, 'base64'));
    
    image.print(font, 10, 10, "Ya Allah!");
    // image.getBase64Async(Jimp.AUTO);

    template.template = image.getBase64Async(Jimp.AUTO);

    await template.updateOne();

    return res.status(200).json({ success: true, message: "Certificate Created Successfully." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding template" });
  }
};

export { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate, createCertificate };
