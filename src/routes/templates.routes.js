import { Router } from 'express'
import { createTemplate, updateTemplate, deleteTemplate, getTemplateById, getTemplatesByUser } from '../controllers/videoTemplateController.js'
import { protect } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'

const router = Router()

router.use(protect)

router.get('/', requirePermission('Templates', 'view'), getTemplatesByUser)
router.get('/:id', requirePermission('Templates', 'view'), getTemplateById)
router.post('/', requirePermission('Templates', 'create'), createTemplate)
router.put('/:id', requirePermission('Templates', 'edit'), updateTemplate)
router.delete('/:id', requirePermission('Templates', 'delete'), deleteTemplate)

export default router

