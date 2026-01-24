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

import settingRouter from './routes/setting.js'
import dashboardRouter from './routes/dashboard.js'

import connectToDatabase from './db/db.js'
import loadCache from './db/loadCache.js'

import reportRouter from './routes/report.js'

await connectToDatabase()
await loadCache()

const app = express()
//app.use(cors()) 

//app.options("*", cors())

//const allowedDomains = ['https://www.unis.org.in', 'https://unis-frontend.vercel.app']
app.use(cors({ origin: '*', credentials: true }));

app.use(express.json())
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

app.use('/api/setting', settingRouter)
app.use('/api/dashboard', dashboardRouter)

app.use('/api/report', reportRouter)

app.listen(process.env.PORT, () => {
    console.log(`Server is Running on port ${process.env.PORT}`)
})
