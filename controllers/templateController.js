import multer from "multer";
import Template from "../models/Template.js";

const upload = multer({});

const addTemplate = async (req, res) => {
  try {
    const {
      courseId,
      details,
    } = req.body;

    const newTemplate = new Template({
      courseId,
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
    const templates = await Template.find().select('details')
      .populate({ path: 'courseId', select: 'name' });

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
        .json({ success: false, error: "Document not found" });
    }

    return res.status(200).json({ success: true, message: "Template details updated Successfully." })

  } catch (error) {
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

export { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate };
