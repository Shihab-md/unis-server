import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth.js'
import supervisorRouter from './routes/supervisor.js'
import schoolRouter from './routes/school.js'
import employeeRouter from './routes/employee.js'
import studentRouter from './routes/student.js'
import instituteRouter from './routes/institute.js'
import courseRouter from './routes/course.js'
import academicYearRouter from './routes/academicYear.js'
import templateRouter from './routes/template.js'
import certificateRouter from './routes/certificate.js'
import districtStateRouter from './routes/districtState.js'
import notificationRouter from './routes/notification.js'
import helpDeskRouter from './routes/helpDesk.js'
import mobileRouter from './routes/mobile.js'

import settingRouter from './routes/setting.js'
import dashboardRouter from './routes/dashboard.js'
import profileRouter from './routes/profile.js'
import resetPassRouter from './routes/resetPass.js'

import connectToDatabase from './db/db.js'
import loadCache from './db/loadCache.js'

import reportRouter from './routes/report.js'

import feesRoutes from "./routes/feesRoutes.js";
import hqFeesRoutes from "./routes/hqFeesRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

import publicRoutes from "./routes/publicRoutes.js";

import googleDriveRoutes from "./routes/googleDriveRoutes.js";

import inspectionReportRoutes from "./routes/inspectionReportRoutes.js";

import certificateBulkIhsRoutes from "./routes/certificateBulkIhsRoutes.js";
import marksheetRouter from './routes/marksheet.js';
import gradeRouter from './routes/grade.js';
import examQuestionRouter from './routes/examQuestion.js';
import attendanceRouter from './routes/attendance.js';
import tempSchoolMarksheetRoutes from "./routes/tempSchoolMarksheetRoutes.js";
import demoTutorialRoutes from "./routes/demoTutorialRoutes.js";
import rolePermissionRouter from "./routes/rolePermission.js";
import { SERVER_VERSION, getAppEnvironment, getCorsAllowedOrigins, validateRuntimeEnvironment } from "./utils/runtimeEnvironment.js";

const runtime = validateRuntimeEnvironment();
console.log(`[environment] ${runtime.environment} | DB=${runtime.databaseName} | server=${SERVER_VERSION}`);

await connectToDatabase()
await loadCache()
 
const app = express()
const allowedOrigins = new Set(getCorsAllowedOrigins());
app.use(cors({
    origin: (origin, callback) => {
        // Native/mobile/server-to-server requests may not send an Origin header.
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin)) return callback(null, true);
        const error = new Error("CORS origin not allowed");
        error.code = "UNIS_CORS_BLOCKED";
        return callback(error);
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'Content-Range', 'Accept-Ranges', 'Content-Length']
}));

app.use(express.json())
app.get('/api/health', (req, res) => {
    return res.status(200).json({
        status: 'ok',
        environment: getAppEnvironment(),
        version: SERVER_VERSION,
    });
});
app.use(express.static('public/uploads'))
app.use('/api/auth', authRouter)
app.use('/api/supervisor', supervisorRouter)
app.use('/api/school', schoolRouter)
app.use('/api/employee', employeeRouter)
app.use('/api/student', studentRouter)
app.use('/api/institute', instituteRouter)
app.use('/api/course', courseRouter)
app.use('/api/academicYear', academicYearRouter)
app.use('/api/template', templateRouter)
app.use('/api/certificate', certificateRouter)
app.use('/api/districtState', districtStateRouter)
app.use('/api/notifications', notificationRouter)
app.use('/api/helpdesk', helpDeskRouter)
app.use('/api/mobile', mobileRouter)

app.use('/api/setting', settingRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/profile', profileRouter)
app.use('/api/resetPass', resetPassRouter)

app.use('/api/report', reportRouter)

// routes
app.use("/api/fees", feesRoutes);
app.use("/api/hq/fees", hqFeesRoutes);
//app.use("/api/upload", uploadRoutes);

app.use("/api/public", publicRoutes);

app.use("/api/integrations/google-drive", googleDriveRoutes);

app.use("/api/inspection-report", inspectionReportRoutes);

app.use("/api/certificate-bulk-ihs", certificateBulkIhsRoutes);
app.use('/api/marksheet', marksheetRouter);
app.use('/api/grade', gradeRouter);
app.use('/api/exam-questions', examQuestionRouter);
app.use('/api/attendance', attendanceRouter);
app.use("/api/temp-school-marksheet", tempSchoolMarksheetRoutes);
app.use("/api/demo-tutorial", demoTutorialRoutes);
app.use("/api/role-permissions", rolePermissionRouter);

app.use((err, req, res, next) => {
    if (err?.code === "UNIS_CORS_BLOCKED") {
        return res.status(403).json({ success: false, error: "Origin is not allowed." });
    }
    return next(err);
});

app.listen(process.env.PORT, () => {
    console.log(`Server is Running on port ${process.env.PORT}`)
})
