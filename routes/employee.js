import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addEmployee, upload, getEmployees, getEmployee, updateEmployee, deleteEmployee, getByEmpFilter, importEmployeesData} from '../controllers/employeeController.js'

const router = express.Router()

router.get('/', authMiddleware, getEmployees)
router.post('/add', authMiddleware, upload.single('file'), addEmployee)
router.get('/:id', authMiddleware, getEmployee)
router.put('/:id', authMiddleware, upload.single('file'), updateEmployee)
router.delete('/:id', authMiddleware, deleteEmployee)

router.get('/byEmpFilter/:empSchoolId/:empRole/:empStatus', authMiddleware, getByEmpFilter)

router.post('/importEmp', authMiddleware, importEmployeesData)

export default router