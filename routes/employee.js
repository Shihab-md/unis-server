import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {
    addEmployee, upload, getEmployees, getEmployee, updateEmployee, deleteEmployee,
    getByEmpFilter, importEmployeesData, getAdminsBySupervisor
} from '../controllers/employeeController.js'
import {
    requireEmployeeReadRole,
    requireEmployeeCreateRole,
    requireEmployeeUpdateRole,
    requireEmployeeDeleteRole,
    requireEmployeeReadAccess,
    requireEmployeeCreateAccess,
    requireEmployeeUpdateAccess,
    requireEmployeeDeleteAccess,
    requireEmployeeHQFilter,
    requireEmployeeImport,
    requireSupervisorAdminList,
} from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// Keep static routes before /:id. V0.4 preserves current web permissions but enforces
// Niswan/Muavin ownership on the server for direct API calls.
router.get('/', authMiddleware, requireEmployeeReadRole, getEmployees)
router.post('/add', authMiddleware, auditMutation({ action: 'EMPLOYEE_CREATE', resourceType: 'Employee' }), requireEmployeeCreateRole, upload.single('file'), requireEmployeeCreateAccess, addEmployee)

router.get('/getAdminsBySup', authMiddleware, requireEmployeeReadRole, requireSupervisorAdminList, getAdminsBySupervisor)
router.get('/byEmpFilter/:empSchoolId/:empRole/:empStatus', authMiddleware, requireEmployeeReadRole, requireEmployeeHQFilter, getByEmpFilter)
const notifyEmployeeImportComplete = notifyOnSuccess({
    type: 'employee.import', title: 'Employee import completed', message: 'An Employee Excel import batch completed successfully.',
    resourceType: 'EmployeeImport', webPath: () => '/dashboard/employees', mobilePath: () => '/(app)/bulk/employee-import',
})
const notifyOnlyOnMobileFinalChunk = (notifier) => (req, res, next) =>
    String(req.headers['x-unis-final-chunk'] || '').toLowerCase() === 'true' ? notifier(req, res, next) : next()

router.post('/importEmp', authMiddleware,
    auditMutation({ action: 'EMPLOYEE_IMPORT', resourceType: 'EmployeeImport' }),
    notifyOnlyOnMobileFinalChunk(notifyEmployeeImportComplete),
    requireEmployeeImport, importEmployeesData)

router.get('/:id', authMiddleware, requireEmployeeReadRole, requireEmployeeReadAccess('id'), getEmployee)
router.put('/:id', authMiddleware, auditMutation({ action: 'EMPLOYEE_UPDATE', resourceType: 'Employee' }), requireEmployeeUpdateRole, upload.single('file'), requireEmployeeUpdateAccess('id'), updateEmployee)
router.delete('/:id', authMiddleware, auditMutation({ action: 'EMPLOYEE_DELETE', resourceType: 'Employee' }), requireEmployeeDeleteRole, requireEmployeeDeleteAccess('id'), deleteEmployee)

export default router
