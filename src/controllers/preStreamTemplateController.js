import PreStreamTemplate from '../models/PreStreamTemplate.js'
import { getCurrentUserOrgId } from '../utils/organizationHelper.js'
import { activeFilter } from '../utils/softDelete.js'
import { getAuditStamp, getSoftDeleteStamp } from '../utils/requestContext.js'
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js'

export const createPreStreamTemplate = async (req, res, next) => {
  try {
    const { userId, name, createdBy } = req.body
    if (!userId || !name || !createdBy) return res.status(400).json({ success: false, error: 'userId, name and createdBy are required' })
    const organizationId = await getCurrentUserOrgId(req)
    const payload = { ...req.body }
    if (organizationId) payload.organization = organizationId
    const doc = await PreStreamTemplate.create(payload)
    return res.json({ success: true, data: doc })
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ success: false, error: 'Template name must be unique for this user' })
    next(e)
  }
}

export const updatePreStreamTemplate = async (req, res, next) => {
  try {
    const { id } = req.params
    const doc = await PreStreamTemplate.findOneAndUpdate({ _id: id, ...activeFilter(req) }, { $set: { ...req.body, ...getAuditStamp(req) } }, { new: true })
    if (!doc) return res.status(404).json({ success: false, error: 'Template not found' })
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'update',
      entity: 'prestream_template',
      entityId: doc._id?.toString?.(),
      orgId: doc.organization || null,
      metadata: { fields: Object.keys(req.body || {}) },
    })
    return res.json({ success: true, data: doc })
  } catch (e) { next(e) }
}

export const deletePreStreamTemplate = async (req, res, next) => {
  try {
    const { id } = req.params
    const doc = await PreStreamTemplate.findOneAndUpdate(
      { _id: id, ...activeFilter(req) },
      { $set: getSoftDeleteStamp(req) },
      { new: true }
    )
    if (!doc) return res.status(404).json({ success: false, error: 'Template not found' })
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'delete',
      entity: 'prestream_template',
      entityId: doc._id?.toString?.(),
      orgId: doc.organization || null,
    })
    return res.json({ success: true })
  } catch (e) { next(e) }
}

export const getPreStreamTemplateById = async (req, res, next) => {
  try {
    const { id } = req.params
    const doc = await PreStreamTemplate.findOne({ _id: id, ...activeFilter(req) })
    if (!doc) return res.status(404).json({ success: false, error: 'Template not found' })
    return res.json({ success: true, data: doc })
  } catch (e) { next(e) }
}

export const getPreStreamTemplatesByUser = async (req, res, next) => {
  try {
    const { userId, search = '', page_no = '1', limit = '10' } = req.query
    if (!userId) return res.status(400).json({ success: false, error: 'userId required' })
    const page = Math.max(parseInt(page_no, 10) || 1, 1)
    const lim = Math.max(parseInt(limit, 10) || 10, 1)
    const query = { userId, ...activeFilter(req) }
    if (String(search).trim()) query.name = { $regex: String(search).trim(), $options: 'i' }
    const total = await PreStreamTemplate.countDocuments(query)
    const docs = await PreStreamTemplate.find(query).sort({ createdAt: -1 }).skip((page - 1) * lim).limit(lim)
    return res.json({ success: true, data: docs, pagination: { total, page, limit: lim, totalPages: Math.ceil(total / lim) } })
  } catch (e) { next(e) }
}

