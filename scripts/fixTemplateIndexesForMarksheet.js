import mongoose from "mongoose";
import dotenv from "dotenv";
import Template from "../models/Template.js";

dotenv.config();

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGO_URI / MONGODB_URI not found in .env");
  }

  await mongoose.connect(uri);

  const collection = Template.collection;
  const indexes = await collection.indexes();

  const oldCourseUnique = indexes.find(
    (idx) => idx?.unique && JSON.stringify(idx.key) === JSON.stringify({ courseId: 1 })
  );

  if (oldCourseUnique?.name) {
    console.log(`Dropping old unique index: ${oldCourseUnique.name}`);
    await collection.dropIndex(oldCourseUnique.name);
  } else {
    console.log("Old unique courseId index not found. Skipping drop.");
  }

  console.log("Normalizing existing templates as CERTIFICATE templates...");
  await Template.updateMany(
    { templateModule: { $exists: false } },
    { $set: { templateModule: "CERTIFICATE", marksheetType: "" } }
  );

  console.log("Creating new compound unique index...");
  await collection.createIndex(
    { courseId: 1, templateModule: 1, marksheetType: 1 },
    { unique: true, name: "course_template_module_type_unique" }
  );

  console.log("Template index migration completed.");
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
