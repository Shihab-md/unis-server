import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth.js'
import departmentRouter from './routes/department.js'
import supervisorRouter from './routes/supervisor.js'
import schoolRouter from './routes/school.js'
import classSectionRouter from './routes/classSection.js'
import employeeRouter from './routes/employee.js'
import salaryRouter from './routes/salary.js'
import leaveRouter from './routes/leave.js' 
import settingRouter from './routes/setting.js'
import attendanceRouter from './routes/attendance.js'
import dashboardRouter from './routes/dashboard.js'
import connectToDatabase from './db/db.js'

connectToDatabase() 
const app = express() 
//app.use(cors()) 

app.options("*", cors())

const allowedDomains = ['https://www.unis.org.in/', 'https://unis-frontend.vercel.app/']
app.use(cors({ origin: allowedDomains, credentials: true }));

app.use(express.json())
app.use(express.static('public/uploads'))
app.use('/api/auth', authRouter)
app.use('/api/department', departmentRouter)
app.use('/api/supervisor', supervisorRouter)
app.use('/api/school', schoolRouter)
app.use('/api/classSection', classSectionRouter)
app.use('/api/employee', employeeRouter)
app.use('/api/salary', salaryRouter)
app.use('/api/leave', leaveRouter)
app.use('/api/setting', settingRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/dashboard', dashboardRouter)

app.listen(process.env.PORT, () => {
    console.log(`Server is Running on port ${process.env.PORT}`)
})
