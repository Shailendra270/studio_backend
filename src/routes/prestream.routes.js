import { Router } from 'express'
import { createPreStreamTemplate, updatePreStreamTemplate, deletePreStreamTemplate, getPreStreamTemplateById, getPreStreamTemplatesByUser } from '../controllers/preStreamTemplateController.js'

const router = Router()

router.get('/', getPreStreamTemplatesByUser)
router.get('/:id', getPreStreamTemplateById)
router.post('/', createPreStreamTemplate)
router.put('/:id', updatePreStreamTemplate)
router.delete('/:id', deletePreStreamTemplate)

export default router

