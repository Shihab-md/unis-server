import {
  getTempSchoolMarksheetTemplateInfo,
  processTempSchoolMarksheetRows,
} from "../services/tempSchoolMarksheetService.js";

const canUseTempSchoolMarksheet = (req) => {
  const role = String(req?.user?.role || "").toLowerCase();
  return ["superadmin", "hquser"].includes(role);
};

const sendError = (res, error, fallbackMessage) => {
  const status = Number(error?.status) || 500;
  return res.status(status).json({
    success: false,
    code: error?.code || "TEMP_SCHOOL_MARKSHEET_ERROR",
    error: error?.message || fallbackMessage,
  });
};

export const getTempSchoolTemplateInfo = async (req, res) => {
  try {
    if (!canUseTempSchoolMarksheet(req)) {
      return res.status(403).json({
        success: false,
        error: "You are not allowed to create temporary school marksheets.",
      });
    }

    // This verifies the configured SE-02 / MARKSHEET / NORMAL record AND
    // downloads/opens the uploaded PDF before the user starts a batch run.
    const template = await getTempSchoolMarksheetTemplateInfo();

    return res.status(200).json({
      success: true,
      template,
    });
  } catch (error) {
    console.log("[getTempSchoolTemplateInfo]", error);
    return sendError(
      res,
      error,
      "Unable to validate the temporary school marksheet template."
    );
  }
};

export const createTempSchoolMarksheets = async (req, res) => {
  try {
    if (!canUseTempSchoolMarksheet(req)) {
      return res.status(403).json({
        success: false,
        error: "You are not allowed to create temporary school marksheets.",
      });
    }

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({
        success: false,
        error: "Rows are required.",
      });
    }

    const templateVersion = req.body?.templateVersion;
    const result = await processTempSchoolMarksheetRows({
      rows,
      expectedTemplateVersion: templateVersion,
    });

    return res.status(200).json({
      success: true,
      message: "Temporary school marksheet batch completed.",
      ...result,
    });
  } catch (error) {
    console.log("[createTempSchoolMarksheets]", error);
    return sendError(
      res,
      error,
      "Server error in temporary school marksheet creation."
    );
  }
};
