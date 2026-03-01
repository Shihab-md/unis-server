import mongoose from "mongoose";
const { Schema } = mongoose;

const integrationCredentialSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true }, // "google_drive"
    refreshTokenEnc: { type: String, required: true },
    folderId: { type: String, required: true },
    connectedBy: { type: Schema.Types.ObjectId, ref: "User" },
    connectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("IntegrationCredential", integrationCredentialSchema);