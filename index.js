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
//app.use(cors({origin: '*'}))
//const cors = require('cors');
// Add headers
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});

// app.use(cors())

//app.use(cors({
//    origin: ['https://unis-frontend.vercel.app/', 'https://www.unis.org.in/', 'https://unis-server.vercel.app/'], 
//    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
//    allowedHeaders: ['Content-Type', 'Origin', 'X-Requested-With', 'Accept', 'x-client-key', 'x-client-token', 'x-client-secret', 'Authorization'],
//    credentials: true
//}))

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
