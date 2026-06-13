export function shouldIncludeDeleted(req) {
  const raw = req?.query?.includeDeleted;
  if (raw === undefined || raw === null) return false;
  const value = String(raw).trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function activeFilter(req) {
  if (shouldIncludeDeleted(req) && req.user?.role === "superadmin") {
    return {};
  }
  // Keeps legacy rows without isDeleted field visible.
  return { isDeleted: { $ne: true } };
}
