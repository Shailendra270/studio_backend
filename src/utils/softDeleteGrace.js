const DEFAULT_GRACE_DAYS = parseInt(process.env.SOFT_DELETE_GRACE_DAYS || '15', 10);

export const getSoftDeleteGraceDays = () => {
  if (Number.isNaN(DEFAULT_GRACE_DAYS) || DEFAULT_GRACE_DAYS < 0) {
    return 15;
  }
  return DEFAULT_GRACE_DAYS;
};

export const computeSoftDeleteRemainingDays = (deletedAt, now = new Date(), graceDays = getSoftDeleteGraceDays()) => {
  if (!deletedAt) return { withinGrace: false, remainingDays: 0 };

  const graceMillis = graceDays * 24 * 60 * 60 * 1000;
  const deadline = new Date(deletedAt.getTime() + graceMillis);
  const diff = deadline.getTime() - now.getTime();

  if (diff <= 0) {
    return { withinGrace: false, remainingDays: 0 };
  }

  const remainingDays = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return { withinGrace: true, remainingDays };
};

