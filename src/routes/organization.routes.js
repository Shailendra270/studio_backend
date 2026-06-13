import express from 'express';
import {
  listOrganizations,
  createOrganization,
  getOrganization,
  getOrganizationOverview,
  updateOrganization,
  deleteOrganization,
  restoreOrganization,
  getOrgLogoUploadUrl,
  listMembers,
  addMember,
  updateMember,
  removeMember,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
} from '../controllers/organization.controller.js';
import { protect } from '../middleware/auth.js';
import { requireOrgMember, requireOrgAdmin } from '../middleware/organizationAuth.js';
import { validateObjectId, handleValidationErrors } from '../middleware/validation.js';

const router = express.Router();

router.use(protect);

router.route('/').get(listOrganizations).post(createOrganization);

// All routes below have :orgId - validate and require membership
const orgRouter = express.Router({ mergeParams: true });
orgRouter.use(validateObjectId('orgId'), handleValidationErrors, requireOrgMember);

orgRouter
  .route('/')
  .get(getOrganization)
  .patch(requireOrgAdmin, updateOrganization)
  .delete(requireOrgAdmin, deleteOrganization);
orgRouter.patch('/restore', requireOrgAdmin, restoreOrganization);
orgRouter.get('/overview', getOrganizationOverview);
orgRouter.post('/logo/upload-url', requireOrgAdmin, getOrgLogoUploadUrl);

orgRouter.get('/members', listMembers);
orgRouter.post('/members', requireOrgAdmin, addMember);
orgRouter.patch('/members/:memberId', requireOrgAdmin, validateObjectId('memberId'), handleValidationErrors, updateMember);
orgRouter.delete('/members/:memberId', requireOrgAdmin, validateObjectId('memberId'), handleValidationErrors, removeMember);

orgRouter.get('/roles', listRoles);
orgRouter.post('/roles', requireOrgAdmin, createRole);
orgRouter.patch('/roles/:roleId', requireOrgAdmin, validateObjectId('roleId'), handleValidationErrors, updateRole);
orgRouter.delete('/roles/:roleId', requireOrgAdmin, validateObjectId('roleId'), handleValidationErrors, deleteRole);

router.use('/:orgId', orgRouter);

export default router;
