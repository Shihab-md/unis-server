import Employee from "../models/Employee.js";
import School from "../models/School.js";
import {
  LEGACY_HQ_SCHOOL_CODE,
  ORGANIZATION_TYPES,
  SCHOOL_RECORD_TYPES,
} from "../config/organizationPolicy.js";

// Phase 5 compatibility migration.
//
// It is intentionally idempotent and non-destructive:
// - the legacy HQ School document is retained for historical references,
// - Employees formerly linked to it are tagged as organizationType=HQ,
// - all other unclassified Employees are tagged NISWAN,
// - no Employee is classified as HQ from User.role alone.
//
// After this runs, runtime authorization must use Employee.organizationType and
// must not require the legacy School document to remain present.
export const migrateOrganizationModel = async () => {
  const legacyHqSchool = await School.findOne({ code: LEGACY_HQ_SCHOOL_CODE })
    .select("_id code recordType")
    .lean();

  let legacyHqEmployees = 0;
  let normalEmployees = 0;
  let legacySchoolMarked = false;

  if (legacyHqSchool?._id) {
    const schoolUpdate = await School.updateOne(
      { _id: legacyHqSchool._id, recordType: { $ne: SCHOOL_RECORD_TYPES.LEGACY_HQ } },
      { $set: { recordType: SCHOOL_RECORD_TYPES.LEGACY_HQ, updatedAt: new Date() } }
    );
    legacySchoolMarked = Number(schoolUpdate?.modifiedCount || 0) > 0;

    const hqUpdate = await Employee.updateMany(
      {
        schoolId: legacyHqSchool._id,
        organizationType: { $ne: ORGANIZATION_TYPES.HQ },
      },
      { $set: { organizationType: ORGANIZATION_TYPES.HQ, updatedAt: new Date() } }
    );
    legacyHqEmployees = Number(hqUpdate?.modifiedCount || 0);
  }

  const normalFilter = {
    $or: [
      { organizationType: { $exists: false } },
      { organizationType: null },
      { organizationType: "" },
    ],
  };
  if (legacyHqSchool?._id) {
    normalFilter.schoolId = { $ne: legacyHqSchool._id };
  }

  const normalUpdate = await Employee.updateMany(
    normalFilter,
    { $set: { organizationType: ORGANIZATION_TYPES.NISWAN, updatedAt: new Date() } }
  );
  normalEmployees = Number(normalUpdate?.modifiedCount || 0);

  console.log(
    `[organization-migration] legacySchool=${legacyHqSchool?._id ? "found" : "not-found"}` +
      ` marked=${legacySchoolMarked ? 1 : 0}` +
      ` hqEmployees=${legacyHqEmployees}` +
      ` niswanEmployees=${normalEmployees}`
  );

  return {
    legacyHqSchoolId: legacyHqSchool?._id ? String(legacyHqSchool._id) : null,
    legacySchoolMarked,
    legacyHqEmployees,
    normalEmployees,
  };
};

export default migrateOrganizationModel;
