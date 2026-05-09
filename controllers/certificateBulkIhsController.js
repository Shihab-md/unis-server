import { processBulkIhsExcelRows } from "../services/certificateBulkIhsService.js";

const createBulkIhsCertificates = async (req, res) => {
  try {
    const role = String(req?.user?.role || "").toLowerCase();

    if (!["superadmin", "hquser"].includes(role)) {
      return res.status(403).json({
        success: false,
        error: "You are not allowed to create bulk IHS certificates.",
      });
    }

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        error: "Rows are required.",
      });
    }

    const result = await processBulkIhsExcelRows({
      rows,
      createdBy: req?.user?._id || null,
    });

    return res.status(200).json({
      success: true,
      message: "Bulk IHS certificate processing completed.",
      ...result,
    });
  } catch (error) {
    console.log(error);

    if (
      String(error?.message || "").includes("Google Drive connection expired") ||
      String(error?.message || "").includes("Google OAuth configuration changed") ||
      String(error?.message || "").includes("Stored Google Drive token is invalid")
    ) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: "server error in bulk IHS certificate creation.",
    });
  }
};

export { createBulkIhsCertificates };