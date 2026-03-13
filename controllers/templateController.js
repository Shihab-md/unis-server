import multer from "multer";
import { put } from "@vercel/blob";
import Template from "../models/Template.js";
import getRedis from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

const upload = multer({ storage: multer.memoryStorage() });

const addTemplate = async (req, res) => {
  let newTemplate;

  try {
    const { courseId, details } = req.body;

    if (!courseId) {
      return res
        .status(400)
        .json({ success: false, error: "courseId is required" });
    }

    // ✅ Check duplicate before create
    const existingTemplate = await Template.findOne({ courseId })
      .select("_id courseId")
      .lean();

    if (existingTemplate) {
      return res.status(400).json({
        success: false,
        error: "Already record found for this course.",
      });
    }

    newTemplate = new Template({
      courseId,
      details: toCamelCase(details),
      template: "-",
    });

    newTemplate = await newTemplate.save();

    const redis = await getRedis();
    await redis.set("totalTemplates", await Template.countDocuments());

    const templatesList = await Template.find()
      .select("_id courseId")
      .populate({ path: "courseId", select: "name" })
      .lean();
    redis.set("templates", JSON.stringify(templatesList), { EX: 60 * 30 });

    if (req.file) {
      const fileBuffer = req.file.buffer;

      let ext = "png";
      let contentType = "image/png";

      if (req.file?.mimetype === "application/pdf") {
        ext = "pdf";
        contentType = "application/pdf";
      } else if (req.file?.mimetype === "image/png") {
        ext = "png";
        contentType = "image/png";
      } else if (req.file?.mimetype === "image/jpeg") {
        ext = "jpg";
        contentType = "image/jpeg";
      }

      const blob = await put(`templates/${newTemplate._id}.${ext}`, fileBuffer, {
        access: "public",
        contentType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      const template = await Template.findByIdAndUpdate(
        newTemplate._id,
        { template: blob.downloadUrl },
        { new: true }
      );

      if (!template) {
        return res
          .status(404)
          .json({ success: false, error: "Template not found." });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Template Created Successfully.",
    });
  } catch (error) {
    if (newTemplate) {
      await Template.deleteOne({ _id: newTemplate._id });
    }

    console.log(error);

    // ✅ In case duplicate happens from race condition / unique index
    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Already record found for this course.",
      });
    }

    return res
      .status(500)
      .json({ success: false, error: "server error in adding template" });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await Template.find().select('details')
      .populate({ path: 'courseId', select: 'code name', sort: 'code' });

    return res.status(200).json({ success: true, templates });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get templates server error" });
  }
};

const getTemplatesFromCache = async (req, res) => {
  try {
    const redis = await getRedis();
    const templates = JSON.parse(await redis.get('templates'));
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
    let template = await Template.findById({ _id: id })
      .populate({ path: 'courseId', select: 'name' });

    return res.status(200).json({ success: true, template });

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "Get template server error" });
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
      const fileBuffer = req.file.buffer;
      const blob = await put("templates/" + id + ".png", fileBuffer, {
        access: 'public',
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      updateTemplate = await Template.findByIdAndUpdate({ _id: id }, { details: toCamelCase(details), template: blob.downloadUrl });
    } else {
      updateTemplate = await Template.findByIdAndUpdate({ _id: id }, { details: toCamelCase(details), })
    }


    {/* if (req.file) {
      updateTemplate = await Template.findByIdAndUpdate({ _id: id },
        {
          details,
          template: req.file.buffer.toString('base64'),
        })
    } else {
      updateTemplate = await Template.findByIdAndUpdate({ _id: id }, { details, })
    }
*/}
    if (!updateTemplate) {
      return res
        .status(404)
        .json({ success: false, error: "Document not Updated" });
    }

    return res.status(200).json({ success: true, message: "Template details updated Successfully." })

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "Update templates server error" });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteTemplate = await Template.findById({ _id: id })
    //await User.findByIdAndDelete({ _id: deleteTemplate.userId._id })
    await deleteTemplate.deleteOne();

    const redis = await getRedis();
    await redis.set('totalTemplates', await Template.countDocuments());

    return res.status(200).json({ success: true, updateTemplate })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Delete Template server error" })
  }
}

export { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate, getTemplatesFromCache };
