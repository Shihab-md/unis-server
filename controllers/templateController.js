import multer from "multer";
import { put } from "@vercel/blob";
import Template from "../models/Template.js";
import redisClient from "../db/redis.js"

const upload = multer({ storage: multer.memoryStorage() });

const addTemplate = async (req, res) => {

  let newTemplate;
  try {
    const {
      courseId,
      details,
    } = req.body;

    newTemplate = new Template({
      courseId,
      details,
      template: "-",
    });

    newTemplate = await newTemplate.save();

    if (req.file) {
      const fileBuffer = req.file.buffer;
      const blob = await put("templates/" + newTemplate._id + ".png", fileBuffer, {
        access: 'public',
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      //  console.log(blob.downloadUrl)
      const template = await Template.findByIdAndUpdate({ _id: newTemplate._id }, { template: blob.downloadUrl });
      if (!template) {
        return res
          .status(404)
          .json({ success: false, error: "Template not found." });
      }
    }

    return res.status(200).json({ success: true, message: "Template Created Successfully." });
  } catch (error) {

    if (newTemplate) {
      await Template.deleteOne({ _id: newTemplate._id });
    }
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding template" });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await Template.find().select('details')
      .populate({ path: 'courseId', select: 'name' });

    return res.status(200).json({ success: true, templates });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get templates server error" });
  }
};

const getTemplatesFromCache = async (req, res) => {
  try {
    const templates = JSON.parse(await redisClient.get('templates'));
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

      updateTemplate = await Template.findByIdAndUpdate({ _id: id }, { details, template: blob.downloadUrl });
    } else {
      updateTemplate = await Template.findByIdAndUpdate({ _id: id }, { details, })
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
    await deleteTemplate.deleteOne()

    return res.status(200).json({ success: true, updateTemplate })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Delete Template server error" })
  }
}

export { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate, getTemplatesFromCache };
