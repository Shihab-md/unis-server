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
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// Keep static routes before /:id. Permission assignment is database-managed;
// existing Employee actor/target/Niswan scope rules remain server-enforced.
router.get('/', authMiddleware,
    requirePermission(PERMISSIONS.EMPLOYEE_VIEW, 'You do not have permission to view Employees.'),
    requireEmployeeReadRole, getEmployees)

router.post('/add', authMiddleware,
    auditMutation({ action: 'EMPLOYEE_CREATE', resourceType: 'Employee' }),
    requirePermission(PERMISSIONS.EMPLOYEE_CREATE, 'You do not have permission to create Employees.'),
    requireEmployeeCreateRole, upload.single('file'), requireEmployeeCreateAccess, addEmployee)

router.get('/getAdminsBySup', authMiddleware,
    requirePermission(PERMISSIONS.EMPLOYEE_VIEW, 'You do not have permission to view Employees.'),
    requireEmployeeReadRole, requireSupervisorAdminList, getAdminsBySupervisor)

router.get('/byEmpFilter/:empSchoolId/:empRole/:empStatus', authMiddleware,
    requirePermission(PERMISSIONS.EMPLOYEE_VIEW, 'You do not have permission to view Employees.'),
    requireEmployeeReadRole, requireEmployeeHQFilter, getByEmpFilter)

const notifyEmployeeImportComplete = notifyOnSuccess({
    type: 'employee.import', title: 'Employee import completed', message: 'An Employee Excel import batch completed successfully.',
    resourceType: 'EmployeeImport', webPath: () => '/dashboard/employees', mobilePath: () => '/(app)/bulk/employee-import',
})
const notifyOnlyOnMobileFinalChunk = (notifier) => (req, res, next) =>
    String(req.headers['x-unis-final-chunk'] || '').toLowerCase() === 'true' ? notifier(req, res, next) : next()

// Import remains a Phase 2.5 bulk-operation permission; preserve current SuperAdmin rule.
router.post('/importEmp', authMiddleware,
    auditMutation({ action: 'EMPLOYEE_IMPORT', resourceType: 'EmployeeImport' }),
    notifyOnlyOnMobileFinalChunk(notifyEmployeeImportComplete),
    requireEmployeeImport, importEmployeesData)

router.get('/:id', authMiddleware,
    requirePermission(PERMISSIONS.EMPLOYEE_VIEW, 'You do not have permission to view Employees.'),
    requireEmployeeReadRole, requireEmployeeReadAccess('id'), getEmployee)

router.put('/:id', authMiddleware,
    auditMutation({ action: 'EMPLOYEE_UPDATE', resourceType: 'Employee' }),
    requirePermission(PERMISSIONS.EMPLOYEE_EDIT, 'You do not have permission to edit Employees.'),
    requireEmployeeUpdateRole, upload.single('file'), requireEmployeeUpdateAccess('id'), updateEmployee)

router.delete('/:id', authMiddleware,
    auditMutation({ action: 'EMPLOYEE_DELETE', resourceType: 'Employee' }),
    requirePermission(PERMISSIONS.EMPLOYEE_DELETE, 'You do not have permission to delete Employees.'),
    requireEmployeeDeleteRole, requireEmployeeDeleteAccess('id'), deleteEmployee)

export default router
