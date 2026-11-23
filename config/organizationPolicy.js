export const ORGANIZATION_TYPES = Object.freeze({
  HQ: "HQ",
  NISWAN: "NISWAN",
});

export const SCHOOL_RECORD_TYPES = Object.freeze({
  NISWAN: "NISWAN",
  LEGACY_HQ: "LEGACY_HQ",
});

// Phase 5 migration-only compatibility value. Runtime HQ authorization must not
// depend on this School code after the migration has classified Employee records.
export const LEGACY_HQ_SCHOOL_CODE = String(
  process.env.UNIS_LEGACY_HQ_SCHOOL_CODE || process.env.UNIS_HQ_SCHOOL_CODE || "UN-00-00001"
).trim();

export const HQ_ORGANIZATION_CODE = String(process.env.UNIS_HQ_CODE || "HQ").trim() || "HQ";
export const HQ_ORGANIZATION_NAME = String(process.env.UNIS_HQ_NAME || "UNIS Headquarters").trim() || "UNIS Headquarters";
export const HQ_EMPLOYEE_ID_PREFIX = String(process.env.UNIS_HQ_EMPLOYEE_ID_PREFIX || "UNHQ").trim().toUpperCase() || "UNHQ";

export const normalizeOrganizationType = (value) =>
  String(value || "").trim().toUpperCase() === ORGANIZATION_TYPES.HQ
    ? ORGANIZATION_TYPES.HQ
    : ORGANIZATION_TYPES.NISWAN;

export const isHqOrganizationType = (value) =>
  normalizeOrganizationType(value) === ORGANIZATION_TYPES.HQ;

export const getHqOrganizationSummary = () => ({
  organizationType: ORGANIZATION_TYPES.HQ,
  code: HQ_ORGANIZATION_CODE,
  nameEnglish: HQ_ORGANIZATION_NAME,
});

export const getNiswanSchoolFilter = () => ({
  recordType: { $ne: SCHOOL_RECORD_TYPES.LEGACY_HQ },
});
